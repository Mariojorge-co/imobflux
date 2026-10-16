-- ImobFlux: busca global. Uma extensão (pg_trgm), um índice e UMA função de leitura nova (nada existente muda).
--
-- search_global(termo, limite, deslocamento) procura em todas as conversas que a pessoa enxerga:
--   * mensagens e legendas (messages.text_content), da mais nova para a mais antiga;
--   * contatos: nome ou telefone, uma linha por conversa individual.
-- Resultado: { total, has_more, results[] } onde cada item traz o tipo, a conversa, a mensagem (quando for texto), a hora,
-- o nome/telefone para exibir e um trecho do texto. Pagina por deslocamento sobre um conjunto limitado (500 mensagens + 100
-- contatos), então a consulta tem custo previsível mesmo com muitas mensagens.
--
-- SECURITY INVOKER: roda como a pessoa logada, então a RLS decide o que ela vê (privacidade de contato, contato protegido,
-- grupo liberado ou não). Para a busca de texto ser rápida, a escolha dos CANDIDATOS usa um auxiliar privado (private.search_message_candidates,
-- DEFINER) que só devolve identificadores de mensagens do workspace da pessoa, achados pelo índice trigram; o conteúdo, a conversa e
-- tudo o que é mostrado vêm de leituras como a própria pessoa, então a RLS corta o que ela não pode ver. (Sem isso, a RLS é avaliada
-- linha a linha ANTES do filtro de texto e a busca varre a tabela inteira: medido em 70 s com 300 mil mensagens.) Não devolve mensagens escondidas nem apagadas. O curinga (% e _) do termo é escapado.
-- O índice trigram acelera o ILIKE '%termo%'; é parcial (só mensagens com texto, visíveis). Criar o índice trava a tabela
-- messages por instantes (índice comum, não concorrente): rodar fora de pico.

create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_messages_text_trgm
    on public.messages using gin (text_content extensions.gin_trgm_ops)
    where text_content is not null and hidden_at is null and deleted_at is null;

create or replace function private.search_message_candidates(p_like_pattern text, p_limit integer)
returns table (message_id uuid)
language sql
stable
security definer
set search_path = ''
as $function$
    select candidate.id
    from public.messages as candidate
    where candidate.workspace_id = (select context.workspace_id from private.active_member_context() as context limit 1)
      and candidate.text_content is not null
      and candidate.hidden_at is null
      and candidate.deleted_at is null
      and candidate.text_content ilike p_like_pattern escape '\'
    order by candidate.occurred_at desc, candidate.id desc
    limit least(greatest(coalesce(p_limit, 2000), 1), 2000);
$function$;

alter function private.search_message_candidates(text, integer) owner to postgres;
revoke all on function private.search_message_candidates(text, integer) from public, anon, service_role;
grant execute on function private.search_message_candidates(text, integer) to authenticated;

create or replace function public.search_global(
    p_query text,
    p_limit integer default 20,
    p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with term as (
        select
            pg_catalog.btrim(coalesce(p_query, '')) as value,
            pg_catalog.regexp_replace(coalesce(p_query, ''), '\D', '', 'g') as digits
    ),
    pattern as (
        select
            value,
            digits,
            '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(value, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_pattern
        from term
    ),
    message_hits as (
        select
            message.conversation_id,
            message.id as message_id,
            message.occurred_at,
            message.text_content as body
        from pattern
        cross join lateral private.search_message_candidates(pattern.like_pattern, 2000) as candidate
        join public.messages as message on message.id = candidate.message_id
        where pg_catalog.char_length(pattern.value) >= 2
          and message.hidden_at is null
          and message.deleted_at is null
        order by message.occurred_at desc, message.id desc
        limit 500
    ),
    contact_hits as (
        select distinct on (conversation.id)
            conversation.id as conversation_id,
            null::uuid as message_id,
            conversation.started_at as occurred_at,
            null::text as body
        from public.contacts as contact
        join public.contact_points as point on point.contact_id = contact.id and point.workspace_id = contact.workspace_id
        join public.conversation_participants as participant
          on participant.contact_point_id = point.id and participant.workspace_id = point.workspace_id and participant.left_at is null
        join public.conversations as conversation
          on conversation.id = participant.conversation_id and conversation.workspace_id = participant.workspace_id
        cross join pattern
        where pg_catalog.char_length(pattern.value) >= 2
          and conversation.conversation_type = 'individual'
          and (
              contact.display_name ilike pattern.like_pattern escape '\'
              or (pg_catalog.char_length(pattern.digits) >= 3
                  and pg_catalog.regexp_replace(coalesce(point.normalized_value, ''), '\D', '', 'g') like '%' || pattern.digits || '%')
          )
        order by conversation.id
        limit 100
    ),
    combined as (
        select 'contact'::text as kind, 0 as rank, contact_hits.* from contact_hits
        union all
        select 'message'::text, 1, message_hits.* from message_hits
    ),
    ordered as (
        select * from combined
        order by rank, occurred_at desc, message_id desc nulls last
    ),
    page as (
        select *
        from ordered
        offset greatest(coalesce(p_offset, 0), 0)
        limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ),
    enriched as (
        select
            page.*,
            conversation.conversation_type,
            conversation.archived_at,
            case
                when conversation.conversation_type = 'group' then coalesce(conversation.subject, 'Grupo WhatsApp')
                else individual_contact.display_name
            end as participant_name,
            case when conversation.conversation_type = 'individual' then point.display_value end as participant_phone,
            -- trecho de ~200 caracteres em volta do termo (o termo aparece no trecho, mesmo em textos longos)
            case when page.body is null then null
                 else pg_catalog.substr(page.body, greatest(1, pg_catalog.strpos(pg_catalog.lower(page.body), pg_catalog.lower((select value from term))) - 60), 200)
            end as snippet
        from page
        join public.conversations as conversation on conversation.id = page.conversation_id
        left join lateral (
            select participant.contact_point_id
            from public.conversation_participants as participant
            where participant.workspace_id = conversation.workspace_id
              and participant.conversation_id = conversation.id
              and participant.left_at is null
            order by participant.first_seen_at, participant.id
            limit 1
        ) as primary_participant on true
        left join public.contact_points as point
          on point.workspace_id = conversation.workspace_id and point.id = primary_participant.contact_point_id
        left join public.contacts as individual_contact
          on individual_contact.workspace_id = point.workspace_id and individual_contact.id = point.contact_id
    )
    select pg_catalog.jsonb_build_object(
        'total', (select count(*) from combined),
        'has_more', (select count(*) from combined) > greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 20), 1), 50),
        'results', coalesce((
            select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'kind', enriched.kind,
                    'conversation_id', enriched.conversation_id,
                    'message_id', enriched.message_id,
                    'occurred_at', enriched.occurred_at,
                    'participant_name', enriched.participant_name,
                    'participant_phone', enriched.participant_phone,
                    'conversation_type', enriched.conversation_type,
                    'archived', enriched.archived_at is not null,
                    'snippet', enriched.snippet
                ) order by enriched.rank, enriched.occurred_at desc, enriched.message_id desc nulls last
            )
            from enriched
        ), '[]'::pg_catalog.jsonb)
    );
$function$;

alter function public.search_global(text, integer, integer) owner to postgres;
revoke all on function public.search_global(text, integer, integer) from public, anon, service_role;
grant execute on function public.search_global(text, integer, integer) to authenticated;
