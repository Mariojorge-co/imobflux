-- ImobFlux: a consulta de auditoria passa a aceitar as categorias novas (respostas rápidas, prazos e mensagens/arquivos),
-- para que os eventos tenham rótulo e filtro próprios na tela de Auditoria em vez de "Outros".
--
-- Retrocompatível: só AMPLIA a lista de filtros aceitos em get_audit_events; assinatura, retorno e demais regras
-- iguais às da migration 20260802004900. Nenhum dado é tocado.

create or replace function public.get_audit_events(
    p_category text default null,
    p_actor_member_id uuid default null,
    p_from timestamptz default null,
    p_to timestamptz default null,
    p_cursor_ts timestamptz default null,
    p_cursor_id uuid default null,
    p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
    v_category text := nullif(pg_catalog.btrim(p_category), '');
    v_events jsonb;
    v_names jsonb;
    v_count integer;
begin
    select context.workspace_id
    into v_workspace_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'audit_not_authorized' using errcode = '42501';
    end if;

    if v_category is not null
       and v_category not in ('team', 'conversation', 'opportunity', 'contact', 'group', 'task', 'export', 'whatsapp', 'bootstrap', 'quick_reply', 'sla', 'message') then
        raise exception 'audit_invalid_filter' using errcode = '22023';
    end if;

    with page as (
        select event.*
        from public.audit_events as event
        where event.workspace_id = v_workspace_id
          and (v_category is null or event.action like v_category || '.%')
          and (p_actor_member_id is null or event.actor_member_id = p_actor_member_id)
          and (p_from is null or event.occurred_at >= p_from)
          and (p_to is null or event.occurred_at < p_to)
          and (
              p_cursor_ts is null
              or (event.occurred_at, event.id) < (p_cursor_ts, coalesce(p_cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
          )
        order by event.occurred_at desc, event.id desc
        limit v_limit + 1
    ), numbered as (
        select page.*, row_number() over (order by page.occurred_at desc, page.id desc) as position
        from page
    )
    select
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', numbered.id,
                    'occurred_at', numbered.occurred_at,
                    'action', numbered.action,
                    'target_type', numbered.target_type,
                    'target_id', numbered.target_id,
                    'result', numbered.result,
                    'actor_type', numbered.actor_type,
                    'actor_member_id', numbered.actor_member_id,
                    'actor_name', actor_user.display_name,
                    'metadata', numbered.metadata
                ) order by numbered.position
            ) filter (where numbered.position <= v_limit),
            '[]'::jsonb
        ),
        count(*)
    into v_events, v_count
    from numbered
    left join public.workspace_members as actor_member
      on actor_member.workspace_id = numbered.workspace_id
     and actor_member.id = numbered.actor_member_id
    left join public.app_users as actor_user
      on actor_user.id = actor_member.user_id;

    -- Nomes de todos os membros citados (autor e ids do metadata), inclusive removidos, só do próprio workspace.
    with refs as (
        select event_item->>'actor_member_id' as ref
        from pg_catalog.jsonb_array_elements(v_events) as event_item
        union
        select event_item->'metadata'->>key_name
        from pg_catalog.jsonb_array_elements(v_events) as event_item,
             unnest(array['member_id', 'from_member_id', 'to_member_id', 'previous_member_id', 'responsible_member_id']) as key_name
    )
    select coalesce(pg_catalog.jsonb_object_agg(member.id::text, member_user.display_name), '{}'::jsonb)
    into v_names
    from public.workspace_members as member
    join public.app_users as member_user on member_user.id = member.user_id
    where member.workspace_id = v_workspace_id
      and member.id::text in (select ref from refs where ref is not null);

    return jsonb_build_object('events', v_events, 'has_more', v_count > v_limit, 'member_names', v_names);
end;
$function$;
