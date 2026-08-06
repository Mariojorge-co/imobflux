-- Sprint 16: RPC pública de leitura de conversas.
-- SECURITY INVOKER: executa com os privilégios do chamador; a RLS das tabelas
-- filtra automaticamente o workspace do usuário autenticado.
-- Sem parâmetro workspace_id; sem service_role; search_path vazio.

create function public.get_conversations_list(
    p_search        text        default null,
    p_cursor_ts     timestamptz default null,
    p_cursor_id     uuid        default null,
    p_limit         int         default 20
)
returns table (
    conversation_id         uuid,
    conversation_type       text,
    visibility              text,
    operational_status      text,
    started_at              timestamptz,
    last_activity_at        timestamptz,
    last_msg_text           text,
    last_msg_direction      text,
    last_msg_occurred_at    timestamptz,
    participant_name        text,
    next_cursor_ts          timestamptz,
    next_cursor_id          uuid
)
language sql
stable
security invoker
set search_path = ''
as $function$
    with bounded_limit as (
        select greatest(1, least(coalesce(p_limit, 20), 100)) as lim
    ),
    -- Obtém a última mensagem de cada conversa via LATERAL (evita N+1 e baixa
    -- todas as mensagens); o índice idx_messages_conversation_cursor suporta
    -- esta consulta diretamente.
    last_message as (
        select
            m.conversation_id,
            m.workspace_id,
            m.text_content  as text_content,
            m.direction     as direction,
            m.occurred_at   as occurred_at
        from public.conversations c
        cross join lateral (
            select
                msg.conversation_id,
                msg.workspace_id,
                msg.text_content,
                msg.direction,
                msg.occurred_at
            from public.messages msg
            where msg.workspace_id    = c.workspace_id
              and msg.conversation_id = c.id
            order by msg.occurred_at desc, msg.id desc
            limit 1
        ) m
    ),
    -- Resolve o nome do participante principal (contato vinculado ou display
    -- externo).  DISTINCT ON evita duplicatas quando uma conversa tem múltiplos
    -- participantes ou pontos de contato.
    primary_participant as (
        select distinct on (cp.conversation_id)
            cp.conversation_id,
            cp.workspace_id,
            coalesce(
                ct.display_name,
                cp_point.display_value,
                cp.external_display_name
            ) as resolved_name,
            coalesce(cp_point.normalized_value, '') as normalized_phone
        from public.conversation_participants cp
        left join public.contact_points cp_point
               on cp_point.workspace_id = cp.workspace_id
              and cp_point.id           = cp.contact_point_id
        left join public.contacts ct
               on ct.workspace_id = cp_point.workspace_id
              and ct.id           = cp_point.contact_id
        where cp.left_at is null
        order by cp.conversation_id,
                 (ct.display_name is not null) desc,
                 cp.first_seen_at asc
    ),
    -- Conjunto principal de conversas com atividade calculada e filtros aplicados.
    ranked as (
        select
            c.id                                                                    as conversation_id,
            c.conversation_type,
            c.visibility,
            c.operational_status,
            c.started_at,
            coalesce(lm.occurred_at, c.started_at)                                 as last_activity_at,
            lm.text_content                                                         as last_msg_text,
            lm.direction                                                            as last_msg_direction,
            lm.occurred_at                                                          as last_msg_occurred_at,
            pp.resolved_name                                                        as participant_name
        from public.conversations c
        left join last_message       lm on lm.workspace_id    = c.workspace_id
                                       and lm.conversation_id = c.id
        left join primary_participant pp on pp.workspace_id    = c.workspace_id
                                        and pp.conversation_id = c.id
        where c.archived_at is null
          -- Filtro de busca: nome do contato, telefone normalizado ou nome externo
          and (
              p_search is null
              or p_search = ''
              or pp.resolved_name    ilike '%' || p_search || '%'
              or pp.normalized_phone ilike '%' || p_search || '%'
          )
          -- Paginação por cursor estável (last_activity_at DESC, id DESC)
          and (
              p_cursor_ts is null
              or (coalesce(lm.occurred_at, c.started_at), c.id)
                 < (p_cursor_ts, p_cursor_id)
          )
        order by last_activity_at desc, c.id desc
        limit (select lim from bounded_limit)
    )
    select
        r.conversation_id,
        r.conversation_type,
        r.visibility,
        r.operational_status,
        r.started_at,
        r.last_activity_at,
        r.last_msg_text,
        r.last_msg_direction,
        r.last_msg_occurred_at,
        r.participant_name,
        -- Cursores do próximo lote (baseados no último item retornado)
        last_value(r.last_activity_at) over w as next_cursor_ts,
        last_value(r.conversation_id)  over w as next_cursor_id
    from ranked r
    window w as (
        rows between unbounded preceding and unbounded following
    );
$function$;

-- Grants: apenas authenticated. Nega anon, public e service_role.
revoke all on function public.get_conversations_list(text, timestamptz, uuid, int)
    from public, anon, service_role;

grant execute on function public.get_conversations_list(text, timestamptz, uuid, int)
    to authenticated;
