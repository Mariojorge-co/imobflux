-- ImobFlux: busca dentro da conversa e edição/exclusão de notas internas.
--
-- Só funções NOVAS (nenhuma existente muda).
--   * search_conversation_messages: busca por texto (mensagens e legendas) e notas internas de UMA conversa, do mais novo
--     para o mais antigo. Roda como o chamador (RLS de messages e internal_notes valem: privacidade, grupos liberados,
--     contato protegido). Não devolve mensagens escondidas nem apagadas. A consulta fica limitada à conversa (usa o índice
--     idx_messages_conversation_cursor) e a 500 resultados; o curinga (% e _) do termo é escapado.
--   * update_internal_note: só o AUTOR edita a própria nota.
--   * archive_internal_note: o AUTOR apaga a própria nota; o OWNER apaga qualquer uma.
--   * list_conversation_notes: as mesmas notas de get_visible_internal_notes, com autor (id) e data de edição, para a tela
--     mostrar "editada" e oferecer editar/apagar só a quem pode.
-- Notas NÃO contam como mensagem nossa (não mexem no prazo) e nunca passam pela Evolution.

create or replace function public.search_conversation_messages(
    p_conversation_id uuid,
    p_query text,
    p_limit integer default 200
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
    with term as (
        select pg_catalog.btrim(coalesce(p_query, '')) as value
    ),
    pattern as (
        select
            value,
            '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(value, '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_pattern
        from term
    ),
    hits as (
        select 'message'::text as kind, message.id, message.occurred_at, message.text_content as body
        from public.messages as message, pattern
        where pg_catalog.char_length(pattern.value) >= 2
          and message.conversation_id = p_conversation_id
          and message.hidden_at is null
          and message.deleted_at is null
          and message.text_content ilike pattern.like_pattern escape '\'
        union all
        select 'note'::text, note.id, note.created_at, note.content
        from public.internal_notes as note, pattern
        where pg_catalog.char_length(pattern.value) >= 2
          and note.conversation_id = p_conversation_id
          and note.archived_at is null
          and note.content ilike pattern.like_pattern escape '\'
    ),
    limited as (
        select * from hits
        order by occurred_at desc, id desc
        limit least(greatest(coalesce(p_limit, 200), 1), 500)
    )
    select pg_catalog.jsonb_build_object(
        'total', (select count(*) from hits),
        'matches', coalesce((
            select pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'kind', limited.kind,
                    'id', limited.id,
                    'occurred_at', limited.occurred_at,
                    'snippet', pg_catalog.left(limited.body, 200)
                ) order by limited.occurred_at desc, limited.id desc
            )
            from limited
        ), '[]'::jsonb)
    );
$function$;

create or replace function public.update_internal_note(p_note_id uuid, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_note public.internal_notes;
    v_content text := pg_catalog.btrim(coalesce(p_content, ''));
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'note_not_authorized' using errcode = '42501';
    end if;
    select note.* into v_note from public.internal_notes as note
    where note.id = p_note_id and note.workspace_id = v_context.workspace_id and note.archived_at is null for update;
    if v_note.id is null then
        raise exception 'note_not_found' using errcode = 'P0002';
    end if;
    if not private.can_access_internal_note(v_note.id) or v_note.author_member_id <> v_context.member_id then
        raise exception 'note_not_authorized' using errcode = '42501';
    end if;
    if pg_catalog.char_length(v_content) < 1 or pg_catalog.char_length(v_content) > 4096 then
        raise exception 'internal_note_content_empty' using errcode = '22023';
    end if;
    if v_content = v_note.content then
        return jsonb_build_object('status', 'unchanged');
    end if;

    update public.internal_notes set content = v_content, updated_at = v_now where id = v_note.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'conversation.note_edited', 'conversation', v_note.conversation_id,
        'success', pg_catalog.jsonb_build_object('note_id', v_note.id), v_now, v_now
    );
    return jsonb_build_object('status', 'success', 'updated_at', v_now);
end;
$function$;

create or replace function public.archive_internal_note(p_note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_note public.internal_notes;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    select context.* into v_context from private.active_member_context() as context limit 1;
    if v_context.member_id is null then
        raise exception 'note_not_authorized' using errcode = '42501';
    end if;
    select note.* into v_note from public.internal_notes as note
    where note.id = p_note_id and note.workspace_id = v_context.workspace_id for update;
    if v_note.id is null then
        raise exception 'note_not_found' using errcode = 'P0002';
    end if;
    if v_note.archived_at is not null then
        return jsonb_build_object('status', 'unchanged');
    end if;
    if not private.can_access_internal_note(v_note.id)
       or (v_context.member_role <> 'owner' and v_note.author_member_id <> v_context.member_id) then
        raise exception 'note_not_authorized' using errcode = '42501';
    end if;

    update public.internal_notes set archived_at = v_now, updated_at = v_now where id = v_note.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'conversation.note_deleted', 'conversation', v_note.conversation_id,
        'success', pg_catalog.jsonb_build_object('note_id', v_note.id), v_now, v_now
    );
    return jsonb_build_object('status', 'success');
end;
$function$;

create or replace function public.list_conversation_notes(
    p_conversation_id uuid,
    p_opportunity_id uuid default null
) returns table (
    id uuid,
    content text,
    created_at timestamptz,
    updated_at timestamptz,
    author_name text,
    author_member_id uuid,
    opportunity_id uuid
)
language sql
stable
security definer
set search_path = ''
as $function$
    select
        note.id,
        note.content,
        note.created_at,
        note.updated_at,
        coalesce(app_user.display_name, 'Usuário') as author_name,
        note.author_member_id,
        note.opportunity_id
    from public.internal_notes as note
    left join public.workspace_members as author on author.id = note.author_member_id
    left join public.app_users as app_user on app_user.id = author.user_id
    where private.can_access_conversation(p_conversation_id)
      and private.can_access_internal_note(note.id)
      and note.archived_at is null
      and note.conversation_id = p_conversation_id
      and (
          note.opportunity_id is null
          or (p_opportunity_id is not null and note.opportunity_id = p_opportunity_id)
      )
    order by note.created_at desc, note.id desc;
$function$;

alter function public.update_internal_note(uuid, text) owner to postgres;
alter function public.archive_internal_note(uuid) owner to postgres;
alter function public.list_conversation_notes(uuid, uuid) owner to postgres;
revoke all on function public.search_conversation_messages(uuid, text, integer) from public, anon, service_role;
revoke all on function public.update_internal_note(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.archive_internal_note(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_conversation_notes(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.search_conversation_messages(uuid, text, integer) to authenticated;
grant execute on function public.update_internal_note(uuid, text) to authenticated;
grant execute on function public.archive_internal_note(uuid) to authenticated;
grant execute on function public.list_conversation_notes(uuid, uuid) to authenticated;

-- Aperto de segurança sem efeito para o app: a migration 001600 não revogava service_role desta função (o padrão do ambiente
-- decide). Ela depende de auth.uid(), então service_role nunca a usa; o revoke deixa isso explícito e igual em todo ambiente.
revoke all on function public.link_opportunity_conversation(uuid, uuid) from service_role;
