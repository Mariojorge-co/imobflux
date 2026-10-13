-- ROLLBACK da migration 20260802004900_review_fixes.sql (manual; NÃO é uma migration).
--
-- Devolve as 9 funções ao estado em que ficam depois da 20260802004800, copiando as definições dos arquivos
-- de origem (2700, 4400, 4500, 4600 e 4700). Só funções: nenhuma tabela nem dado é tocado.
-- Os revokes de service_role feitos pela 004900 PODEM ficar (são mais restritivos e inofensivos).
-- Efeitos de uso que não se desfazem: convites/identidades reaproveitados continuam válidos (o vínculo aponta
-- para o mesmo app_users), e eventos de auditoria já gravados são permanentes.
--
-- Como usar (produção, só com autorização): rodar este arquivo no SQL do banco, DENTRO de uma transação:
--   begin; \i este-arquivo.sql; -- conferir; commit;
-- e, se a migration for considerada revertida, registrar:  supabase migration repair --status reverted 20260802004900
-- ATENÇÃO: depois do rollback, o app desta branch continua funcionando (cai nos comportamentos antigos:
-- reconvite de removido volta a falhar, nomes de removidos aparecem como "outro membro", teto de 20.000 linhas).

begin;

create or replace function public.prepare_team_invitation(
    p_display_name text,
    p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
    v_display_name text := pg_catalog.btrim(p_display_name);
    v_existing_status text;
    v_app_user_id uuid;
    v_member_id uuid;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select context.workspace_id, context.member_id
    into v_workspace_id, v_owner_member_id
    from private.active_member_context() as context
    where context.member_role = 'owner';

    if v_workspace_id is null then
        raise exception 'team_management_not_authorized' using errcode = '42501';
    end if;

    if v_display_name is null or v_display_name = '' then
        raise exception 'team_member_name_required' using errcode = '22023';
    end if;

    if v_email is null
       or v_email = ''
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        raise exception 'team_member_email_invalid' using errcode = '22023';
    end if;

    select member.status
    into v_existing_status
    from public.workspace_members as member
    join public.app_users as app_user on app_user.id = member.user_id
    left join auth.users as auth_user on auth_user.id = app_user.auth_user_id
    where member.workspace_id = v_workspace_id
      and member.status <> 'removed'
      and (
          member.invited_email_normalized = v_email
          or pg_catalog.lower(auth_user.email::text) = v_email
      )
    order by member.created_at desc
    limit 1;

    if v_existing_status = 'active' then
        raise exception 'team_member_already_active' using errcode = '23505';
    elsif v_existing_status = 'invited' then
        raise exception 'team_invitation_already_pending' using errcode = '23505';
    elsif v_existing_status = 'suspended' then
        raise exception 'team_member_inactive' using errcode = '55000';
    end if;

    insert into public.app_users (display_name, status)
    values (v_display_name, 'active')
    returning id into v_app_user_id;

    insert into public.workspace_members (
        workspace_id,
        user_id,
        invited_email_normalized,
        role,
        status,
        invited_by_member_id,
        invited_at,
        invitation_expires_at
    )
    values (
        v_workspace_id,
        v_app_user_id,
        v_email,
        'attendant',
        'invited',
        v_owner_member_id,
        v_now,
        v_now + interval '1 hour'
    )
    returning id into v_member_id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    )
    values (
        v_workspace_id, 'member', v_owner_member_id,
        'team.invitation_created', 'workspace_member', v_member_id,
        'success', pg_catalog.jsonb_build_object('role', 'attendant'), v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'member_id', v_member_id,
        'email', v_email,
        'display_name', v_display_name,
        'expires_at', v_now + interval '1 hour'
    );
end;
$function$;

create or replace function public.assign_conversation(p_conversation_id uuid, p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_actor_member_id uuid;
    v_target_role text;
    v_assignment_id uuid;
    v_now timestamptz := statement_timestamp();
begin
    select conversation.workspace_id into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id;

    select context.member_id into v_actor_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id;

    if v_workspace_id is null or v_actor_member_id is null
       or not private.can_access_conversation(p_conversation_id) then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    select member.role into v_target_role
    from public.workspace_members as member
    where member.id = p_member_id
      and member.workspace_id = v_workspace_id
      and member.status = 'active';

    if v_target_role is null then
        raise exception 'assignee_not_active' using errcode = '22023';
    end if;
    if v_target_role = 'attendant' and not private.is_conversation_team_visible(p_conversation_id) then
        raise exception 'assignee_cannot_access_conversation' using errcode = '22023';
    end if;

    insert into public.conversation_assignments (
        workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at
    )
    values (v_workspace_id, p_conversation_id, p_member_id, v_actor_member_id, v_now)
    on conflict (conversation_id, member_id) where ended_at is null do nothing
    returning id into v_assignment_id;

    if v_assignment_id is null then
        return jsonb_build_object('success', true, 'status', 'unchanged');
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_actor_member_id, 'conversation.assigned', 'conversation',
        p_conversation_id, 'success', jsonb_build_object('member_id', p_member_id), v_now, v_now
    );

    return jsonb_build_object('success', true, 'status', 'assigned', 'assignment_id', v_assignment_id);
end;
$function$;

create or replace function public.reassign_conversation(
    p_conversation_id uuid,
    p_from_member_id uuid,
    p_to_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_actor_member_id uuid;
    v_target_role text;
    v_ended integer;
    v_new_assignment_id uuid;
    v_now timestamptz := statement_timestamp();
begin
    select conversation.workspace_id into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id;

    select context.member_id into v_actor_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id;

    if v_workspace_id is null or v_actor_member_id is null
       or not private.can_access_conversation(p_conversation_id) then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    if p_from_member_id is null or p_to_member_id is null or p_from_member_id = p_to_member_id then
        raise exception 'assignment_invalid' using errcode = '22023';
    end if;

    select member.role into v_target_role
    from public.workspace_members as member
    where member.id = p_to_member_id
      and member.workspace_id = v_workspace_id
      and member.status = 'active';

    if v_target_role is null then
        raise exception 'assignee_not_active' using errcode = '22023';
    end if;
    if v_target_role = 'attendant' and not private.is_conversation_team_visible(p_conversation_id) then
        raise exception 'assignee_cannot_access_conversation' using errcode = '22023';
    end if;

    update public.conversation_assignments
    set ended_at = greatest(v_now, assigned_at),
        ended_by_member_id = v_actor_member_id,
        end_reason = 'reassigned'
    where workspace_id = v_workspace_id
      and conversation_id = p_conversation_id
      and member_id = p_from_member_id
      and ended_at is null;
    get diagnostics v_ended = row_count;

    if v_ended = 0 then
        raise exception 'assignment_not_found' using errcode = '55000';
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_workspace_id, 'member', v_actor_member_id, 'conversation.unassigned', 'conversation',
        p_conversation_id, 'success',
        jsonb_build_object('member_id', p_from_member_id, 'reason', 'reassigned', 'to_member_id', p_to_member_id),
        v_now, v_now
    );

    insert into public.conversation_assignments (
        workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at
    )
    values (v_workspace_id, p_conversation_id, p_to_member_id, v_actor_member_id, v_now)
    on conflict (conversation_id, member_id) where ended_at is null do nothing
    returning id into v_new_assignment_id;

    if v_new_assignment_id is not null then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        ) values (
            v_workspace_id, 'member', v_actor_member_id, 'conversation.assigned', 'conversation',
            p_conversation_id, 'success',
            jsonb_build_object('member_id', p_to_member_id, 'from_member_id', p_from_member_id),
            v_now, v_now
        );
    end if;

    return jsonb_build_object('success', true, 'status', 'reassigned');
end;
$function$;

create or replace function public.create_work_task(
    p_title text,
    p_task_type text default 'task',
    p_due_at timestamptz default null,
    p_priority text default 'normal',
    p_responsible_member_id uuid default null,
    p_description text default null,
    p_reminder_at timestamptz default null,
    p_contact_id uuid default null,
    p_opportunity_id uuid default null,
    p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task_id uuid;
    v_title text := pg_catalog.btrim(coalesce(p_title, ''));
    v_description text := nullif(pg_catalog.btrim(coalesce(p_description, '')), '');
    v_due timestamptz;
    v_target_role text;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    if v_title = '' or pg_catalog.length(v_title) > 200
       or coalesce(p_task_type, '') not in ('task', 'follow_up')
       or coalesce(p_priority, '') not in ('low', 'normal', 'high', 'urgent')
       or (v_description is not null and pg_catalog.length(v_description) > 2000) then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    if num_nonnulls(p_contact_id, p_opportunity_id, p_conversation_id) < 1
       or (p_contact_id is not null and not private.can_access_contact(p_contact_id))
       or (p_opportunity_id is not null and not private.can_access_opportunity(p_opportunity_id))
       or (p_conversation_id is not null and not private.can_access_conversation(p_conversation_id)) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if p_contact_id is not null and p_opportunity_id is not null and not exists (
        select 1 from public.opportunities
        where id = p_opportunity_id and contact_id = p_contact_id and workspace_id = v_context.workspace_id
    ) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if p_contact_id is not null and p_conversation_id is not null and not exists (
        select 1 from public.conversation_participants as participant
        join public.contact_points as point on point.id = participant.contact_point_id
        where participant.conversation_id = p_conversation_id
          and point.contact_id = p_contact_id and participant.left_at is null
    ) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    v_due := coalesce(p_due_at, v_now + interval '1 day');
    if p_reminder_at is not null and p_reminder_at > v_due then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    if p_responsible_member_id is not null then
        select member.role into v_target_role
        from public.workspace_members as member
        where member.id = p_responsible_member_id
          and member.workspace_id = v_context.workspace_id
          and member.status = 'active';
        if v_target_role is null then
            raise exception 'assignee_not_active' using errcode = '22023';
        end if;
        if v_target_role = 'attendant'
           and not private.is_task_context_team_visible(p_contact_id, p_opportunity_id, p_conversation_id) then
            raise exception 'assignee_cannot_access_task' using errcode = '22023';
        end if;
    end if;

    insert into public.work_tasks (
        workspace_id, task_type, title, description, status, priority, due_at, reminder_at,
        responsible_member_id, contact_id, opportunity_id, conversation_id, created_by_member_id
    ) values (
        v_context.workspace_id, p_task_type, v_title, v_description, 'pending', p_priority, v_due, p_reminder_at,
        p_responsible_member_id, p_contact_id, p_opportunity_id, p_conversation_id, v_context.member_id
    ) returning id into v_task_id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.created', 'task', v_task_id, 'success',
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'task_type', p_task_type, 'priority', p_priority,
            'responsible_member_id', p_responsible_member_id,
            'contact_id', p_contact_id, 'opportunity_id', p_opportunity_id, 'conversation_id', p_conversation_id
        )),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'task_id', v_task_id);
end;
$function$;

create or replace function public.reassign_work_task(p_task_id uuid, p_responsible_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task public.work_tasks%rowtype;
    v_target_role text;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_work_task(p_task_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    select task.* into v_task
    from public.work_tasks as task
    where task.id = p_task_id and task.workspace_id = v_context.workspace_id
    for update;
    if not found then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if v_task.status <> 'pending' then
        raise exception 'task_not_pending' using errcode = '55000';
    end if;

    if v_task.responsible_member_id is not distinct from p_responsible_member_id then
        return pg_catalog.jsonb_build_object('success', true, 'status', 'unchanged');
    end if;

    if p_responsible_member_id is not null then
        select member.role into v_target_role
        from public.workspace_members as member
        where member.id = p_responsible_member_id
          and member.workspace_id = v_context.workspace_id
          and member.status = 'active';
        if v_target_role is null then
            raise exception 'assignee_not_active' using errcode = '22023';
        end if;
        if v_target_role = 'attendant'
           and not private.is_task_context_team_visible(v_task.contact_id, v_task.opportunity_id, v_task.conversation_id) then
            raise exception 'assignee_cannot_access_task' using errcode = '22023';
        end if;
    end if;

    update public.work_tasks
    set responsible_member_id = p_responsible_member_id,
        updated_at = greatest(v_now, v_task.created_at)
    where id = v_task.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.reassigned', 'task', v_task.id, 'success',
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'from_member_id', v_task.responsible_member_id, 'to_member_id', p_responsible_member_id
        )),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'success', true,
        'status', case when p_responsible_member_id is null then 'unassigned' else 'reassigned' end
    );
end;
$function$;

create or replace function public.complete_work_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task public.work_tasks%rowtype;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null or not private.can_access_work_task(p_task_id) then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    select task.* into v_task
    from public.work_tasks as task
    where task.id = p_task_id and task.workspace_id = v_context.workspace_id
    for update;
    if not found then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if v_task.status <> 'pending' then
        raise exception 'task_not_pending' using errcode = '55000';
    end if;

    update public.work_tasks
    set status = 'completed',
        completed_at = greatest(v_now, v_task.created_at),
        completed_by_member_id = v_context.member_id,
        updated_at = greatest(v_now, v_task.created_at)
    where id = v_task.id;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'task.completed', 'task', v_task.id, 'success',
        '{}'::jsonb, v_now, v_now
    );

    return pg_catalog.jsonb_build_object('success', true, 'task_id', v_task.id);
end;
$function$;

create or replace function public.upsert_work_task(
    p_task_type text,
    p_title text,
    p_due_at timestamptz,
    p_contact_id uuid default null,
    p_opportunity_id uuid default null,
    p_conversation_id uuid default null,
    p_task_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_task_id uuid;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;
    if nullif(btrim(p_title), '') is null or p_task_type not in ('task', 'follow_up') then
        raise exception 'invalid_task' using errcode = '22023';
    end if;

    if p_task_id is not null then
        if not private.can_access_work_task(p_task_id) then
            raise exception 'resource_not_available' using errcode = '42501';
        end if;
        update public.work_tasks set title = btrim(p_title), due_at = coalesce(p_due_at, due_at),
            task_type = p_task_type, updated_at = statement_timestamp()
        where id = p_task_id and workspace_id = v_context.workspace_id
        returning id into v_task_id;

        if v_task_id is not null then
            insert into public.audit_events (
                workspace_id, actor_type, actor_member_id, action, target_type,
                target_id, result, metadata, occurred_at, recorded_at
            ) values (
                v_context.workspace_id, 'member', v_context.member_id, 'task.updated', 'task', v_task_id, 'success',
                pg_catalog.jsonb_build_object('fields', pg_catalog.jsonb_build_array('title', 'due_at', 'task_type')),
                v_now, v_now
            );
        end if;
    else
        if num_nonnulls(p_contact_id, p_opportunity_id, p_conversation_id) < 1
           or (p_contact_id is not null and not private.can_access_contact(p_contact_id))
           or (p_opportunity_id is not null and not private.can_access_opportunity(p_opportunity_id))
           or (p_conversation_id is not null and not private.can_access_conversation(p_conversation_id)) then
            raise exception 'resource_not_available' using errcode = '42501';
        end if;
        if p_contact_id is not null and p_opportunity_id is not null and not exists (
            select 1 from public.opportunities where id = p_opportunity_id
              and contact_id = p_contact_id and workspace_id = v_context.workspace_id
        ) then raise exception 'resource_not_available' using errcode = '42501'; end if;
        if p_contact_id is not null and p_conversation_id is not null and not exists (
            select 1 from public.conversation_participants as participant
            join public.contact_points as point on point.id = participant.contact_point_id
            where participant.conversation_id = p_conversation_id
              and point.contact_id = p_contact_id and participant.left_at is null
        ) then
            raise exception 'resource_not_available' using errcode = '42501';
        end if;
        insert into public.work_tasks (
            workspace_id, task_type, title, status, priority, due_at,
            contact_id, opportunity_id, conversation_id, created_by_member_id
        ) values (
            v_context.workspace_id, p_task_type, btrim(p_title), 'pending', 'normal',
            coalesce(p_due_at, statement_timestamp() + interval '1 day'),
            p_contact_id, p_opportunity_id, p_conversation_id, v_context.member_id
        ) returning id into v_task_id;

        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        ) values (
            v_context.workspace_id, 'member', v_context.member_id, 'task.created', 'task', v_task_id, 'success',
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                'task_type', p_task_type, 'priority', 'normal',
                'contact_id', p_contact_id, 'opportunity_id', p_opportunity_id, 'conversation_id', p_conversation_id
            )),
            v_now, v_now
        );
    end if;
    return jsonb_build_object('success', true, 'task_id', v_task_id);
end;
$function$;

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
       and v_category not in ('team', 'conversation', 'opportunity', 'contact', 'group', 'task', 'export', 'whatsapp', 'bootstrap') then
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

    return jsonb_build_object('events', v_events, 'has_more', v_count > v_limit);
end;
$function$;

create or replace function public.export_dataset(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_context record;
    v_rows jsonb;
    v_count integer;
    v_limit constant integer := 20000;
    v_now timestamptz := pg_catalog.statement_timestamp();
begin
    if p_kind is null or p_kind not in ('contacts', 'opportunities') then
        raise exception 'invalid_export_kind' using errcode = '22023';
    end if;

    select * into v_context from private.active_member_context() limit 1;
    if v_context.member_id is null then
        raise exception 'resource_not_available' using errcode = '42501';
    end if;

    if v_context.member_role <> 'owner' then
        insert into public.audit_events (
            workspace_id, actor_type, actor_member_id, action, target_type,
            target_id, result, metadata, occurred_at, recorded_at
        ) values (
            v_context.workspace_id, 'member', v_context.member_id, 'export.' || p_kind, 'workspace',
            v_context.workspace_id, 'denied', '{}'::jsonb, v_now, v_now
        );
        return pg_catalog.jsonb_build_object('success', false, 'error', 'forbidden');
    end if;

    if p_kind = 'contacts' then
        select
            coalesce(pg_catalog.jsonb_agg(row_data order by row_created_at, row_id), '[]'::jsonb),
            count(*)::integer
        into v_rows, v_count
        from (
            select
                contact.id as row_id,
                contact.created_at as row_created_at,
                pg_catalog.jsonb_build_object(
                    'id', contact.id,
                    'display_name', contact.display_name,
                    'classification', contact.classification,
                    'operational_status', contact.operational_status,
                    'registration_status', contact.registration_status,
                    'is_protected', contact.is_protected,
                    'phones', (
                        select string_agg(point.display_value, ' | ' order by point.created_at, point.id)
                        from public.contact_points as point
                        where point.workspace_id = contact.workspace_id
                          and point.contact_id = contact.id
                          and point.point_type = 'phone'
                    ),
                    'created_at', contact.created_at,
                    'updated_at', contact.updated_at,
                    'archived_at', contact.archived_at
                ) as row_data
            from public.contacts as contact
            where contact.workspace_id = v_context.workspace_id
            order by contact.created_at, contact.id
            limit v_limit + 1
        ) as limited;
    else
        select
            coalesce(pg_catalog.jsonb_agg(row_data order by row_created_at, row_id), '[]'::jsonb),
            count(*)::integer
        into v_rows, v_count
        from (
            select
                opportunity.id as row_id,
                opportunity.created_at as row_created_at,
                pg_catalog.jsonb_build_object(
                    'id', opportunity.id,
                    'title', opportunity.title,
                    'contact_name', contact.display_name,
                    'stage_name', stage.name,
                    'status', opportunity.status,
                    'responsible_name', responsible_user.display_name,
                    'origin', opportunity.origin,
                    'operation_type', opportunity.operation_type,
                    'property_type_preference', opportunity.property_type_preference,
                    'city_region_preference', opportunity.city_region_preference,
                    'value_range_preference', opportunity.value_range_preference,
                    'timeframe_intent', opportunity.timeframe_intent,
                    'created_at', opportunity.created_at,
                    'updated_at', opportunity.updated_at,
                    'closed_at', opportunity.closed_at,
                    'archived_at', opportunity.archived_at
                ) as row_data
            from public.opportunities as opportunity
            join public.contacts as contact
              on contact.workspace_id = opportunity.workspace_id and contact.id = opportunity.contact_id
            left join public.pipeline_stages as stage
              on stage.workspace_id = opportunity.workspace_id and stage.id = opportunity.current_stage_id
            left join public.workspace_members as responsible_member
              on responsible_member.workspace_id = opportunity.workspace_id and responsible_member.id = opportunity.responsible_member_id
            left join public.app_users as responsible_user
              on responsible_user.id = responsible_member.user_id
            where opportunity.workspace_id = v_context.workspace_id
            order by opportunity.created_at, opportunity.id
            limit v_limit + 1
        ) as limited;
    end if;

    -- A linha extra só serve para detectar excesso: é descartada.
    if v_count > v_limit then
        v_rows := (select pg_catalog.jsonb_agg(item) from (
            select item from pg_catalog.jsonb_array_elements(v_rows) with ordinality as t(item, position)
            order by position limit v_limit
        ) as trimmed);
    end if;

    insert into public.audit_events (
        workspace_id, actor_type, actor_member_id, action, target_type,
        target_id, result, metadata, occurred_at, recorded_at
    ) values (
        v_context.workspace_id, 'member', v_context.member_id, 'export.' || p_kind, 'workspace',
        v_context.workspace_id, 'success',
        pg_catalog.jsonb_build_object('row_count', least(v_count, v_limit), 'truncated', v_count > v_limit),
        v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'success', true,
        'kind', p_kind,
        'rows', v_rows,
        'truncated', v_count > v_limit,
        'generated_at', v_now
    );
end;
$function$;

-- Permissões e donos (as funções já existem; create or replace preserva, isto só reafirma)
alter function public.prepare_team_invitation(text, text) owner to postgres;
alter function public.assign_conversation(uuid, uuid) owner to postgres;
alter function public.reassign_conversation(uuid, uuid, uuid) owner to postgres;
alter function public.create_work_task(text, text, timestamptz, text, uuid, text, timestamptz, uuid, uuid, uuid) owner to postgres;
alter function public.reassign_work_task(uuid, uuid) owner to postgres;
alter function public.complete_work_task(uuid) owner to postgres;
alter function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.get_audit_events(text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) owner to postgres;
alter function public.export_dataset(text) owner to postgres;

commit;
