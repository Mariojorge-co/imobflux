-- ImobFlux: correções da revisão adversarial da branch feat/mvp-noite (achados A1, B1 a B5 e M1).
--
-- Esta migration vem DEPOIS de 004300 a 004800 e não altera nenhuma delas. Só redefine funções
-- (create or replace) e permissões; não mexe em tabelas nem em dados. Rollback no fim do arquivo.
--
--   A1  prepare_team_invitation reaproveita o app_users existente (achado pelo e-mail em auth.users) ao
--       reconvidar alguém cujo vínculo foi removido. Antes, o convite criava um app_users novo que nunca
--       conseguia ser vinculado ao acesso já existente (team_auth_identity_already_linked) e o aceite
--       falhava. Pessoa ativa em outro workspace ou identidade desativada: team_identity_unavailable.
--   B1  revoke explícito de service_role nas funções novas (não depender do privilégio padrão do ambiente).
--   B2  assign_conversation, reassign_conversation, create_work_task e reassign_work_task leem o membro com
--       FOR SHARE: uma remoção concorrente (FOR UPDATE) espera, e a atribuição nunca "ressuscita" um removido.
--   B3  complete_work_task é idempotente em tarefa já concluída (status already_completed, sem novo evento).
--   B4  upsert_work_task só edita tarefa pendente (task_not_pending), como update_work_task.

-- ─── A1: reconvidar quem foi removido ───────────────────────────────────────────────────────────
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
    v_app_user_status text;
    v_existing_name text;
    v_auth_user_id uuid;
    v_reused boolean := false;
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

    -- Identidade que já existe (ex.: convite anterior aceito e depois removido): reaproveita o app_users,
    -- senão o novo convite nunca poderia ser vinculado ao acesso existente. O nome já cadastrado é mantido.
    select auth_user.id
    into v_auth_user_id
    from auth.users as auth_user
    where pg_catalog.lower(pg_catalog.btrim(auth_user.email::text)) = v_email
    limit 1;

    if v_auth_user_id is not null then
        select app_user.id, app_user.status, app_user.display_name
        into v_app_user_id, v_app_user_status, v_existing_name
        from public.app_users as app_user
        where app_user.auth_user_id = v_auth_user_id;

        if v_app_user_id is not null then
            -- Identidade desativada, ou com vínculo vivo em outro workspace (dois contextos ativos
            -- não são suportados): não reaproveita.
            if v_app_user_status <> 'active' or exists (
                select 1 from public.workspace_members as other
                where other.user_id = v_app_user_id and other.status <> 'removed'
            ) then
                raise exception 'team_identity_unavailable' using errcode = '55000';
            end if;
            v_reused := true;
            v_display_name := coalesce(v_existing_name, v_display_name);
        end if;
    end if;

    if v_app_user_id is null then
        insert into public.app_users (display_name, status)
        values (v_display_name, 'active')
        returning id into v_app_user_id;
    end if;

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
        'success', pg_catalog.jsonb_build_object('role', 'attendant', 'identity_reused', v_reused), v_now, v_now
    );

    return pg_catalog.jsonb_build_object(
        'member_id', v_member_id,
        'email', v_email,
        'display_name', v_display_name,
        'expires_at', v_now + interval '1 hour',
        'identity_reused', v_reused
    );
end;
$function$;

-- ─── B2: ler o membro com FOR SHARE (fecha a corrida com remove_team_member) ──────────────────────────
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
      and member.status = 'active'
        for share of member;

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
      and member.status = 'active'
        for share of member;

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
          and member.status = 'active'
        for share of member;
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
          and member.status = 'active'
        for share of member;
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

-- ─── B3: concluir tarefa já concluída é idempotente ──────────────────────────────────────────────
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
    -- Concluir de novo é idempotente (duplo clique, dois membros ao mesmo tempo): sucesso sem novo evento.
    if v_task.status = 'completed' then
        return pg_catalog.jsonb_build_object('success', true, 'status', 'already_completed', 'task_id', v_task.id);
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

    return pg_catalog.jsonb_build_object('success', true, 'status', 'completed', 'task_id', v_task.id);
end;
$function$;

-- ─── B4: upsert_work_task só edita tarefa pendente ───────────────────────────────────────────────
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
        -- Só tarefa pendente é editável (igual a update_work_task).
        if not exists (
            select 1 from public.work_tasks as task
            where task.id = p_task_id and task.workspace_id = v_context.workspace_id and task.status = 'pending'
        ) then
            raise exception 'task_not_pending' using errcode = '55000';
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

-- ─── B1: revoke explícito de service_role (independe do privilégio padrão do ambiente) ───────────────
-- Todas estas funções dependem de auth.uid(); com a chave de serviço o contexto é vazio e elas recusam.
-- Mesmo assim, o acesso é fechado de forma explícita, como nas funções de equipe mais antigas.
revoke all on function public.remove_team_member(uuid) from public, anon, service_role;
revoke all on function public.assign_conversation(uuid, uuid) from public, anon, service_role;
revoke all on function public.unassign_conversation(uuid, uuid) from public, anon, service_role;
revoke all on function public.reassign_conversation(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function public.prepare_team_invitation(text, text) from public, anon, service_role;
revoke all on function public.complete_work_task(uuid) from public, anon, service_role;
revoke all on function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) from public, anon, service_role;
revoke all on function private.is_conversation_team_visible(uuid) from public, anon, authenticated, service_role;
revoke all on function private.is_task_context_team_visible(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.member_display_name(uuid, uuid) from public, anon, service_role;

-- Funções redefinidas acima: garante dono e permissões finais
alter function public.prepare_team_invitation(text, text) owner to postgres;
alter function public.assign_conversation(uuid, uuid) owner to postgres;
alter function public.reassign_conversation(uuid, uuid, uuid) owner to postgres;
alter function public.create_work_task(text, text, timestamptz, text, uuid, text, timestamptz, uuid, uuid, uuid) owner to postgres;
alter function public.reassign_work_task(uuid, uuid) owner to postgres;
alter function public.complete_work_task(uuid) owner to postgres;
alter function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) owner to postgres;
alter function public.get_audit_events(text, uuid, timestamptz, timestamptz, timestamptz, uuid, integer) owner to postgres;
alter function public.export_dataset(text) owner to postgres;
grant execute on function public.prepare_team_invitation(text, text) to authenticated;
grant execute on function public.complete_work_task(uuid) to authenticated;
grant execute on function public.upsert_work_task(text, text, timestamptz, uuid, uuid, uuid, uuid) to authenticated;

-- ─── ROLLBACK (manual, só funções; nada de tabela nem de dado) ───────────────────────────────────────
-- Restaurar as definições anteriores, copiando o corpo dos arquivos indicados:
--   prepare_team_invitation        <- 20260802002700_add_team_management.sql
--   assign_conversation / reassign_conversation <- 20260802004400_conversation_assignments.sql
--   create_work_task / reassign_work_task / complete_work_task / upsert_work_task <- 20260802004600_work_tasks.sql
--   get_audit_events               <- 20260802004500_audit_trail.sql
--   export_dataset                 <- 20260802004700_export_dataset.sql
-- Os revokes de service_role podem ficar (são mais restritivos e inofensivos).
-- Convites criados com identidade reaproveitada continuam válidos: o vínculo aponta para o mesmo app_users.
