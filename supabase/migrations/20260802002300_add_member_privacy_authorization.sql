-- ImobFlux: active member authorization, temporal privacy, and audited visibility changes.

create or replace function private.active_member_context()
returns table (
    app_user_id uuid,
    member_id uuid,
    workspace_id uuid,
    member_role text
)
language sql
stable
security definer
set search_path = ''
as $function$
    select
        app_user.id,
        member.id,
        workspace.id,
        member.role
    from public.app_users as app_user
    join public.workspace_members as member
      on member.user_id = app_user.id
    join public.workspaces as workspace
      on workspace.id = member.workspace_id
    where app_user.auth_user_id = (select auth.uid())
      and app_user.status = 'active'
      and member.status = 'active'
      and member.role in ('owner', 'attendant')
      and workspace.status = 'active';
$function$;

create or replace function private.is_owner_in_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from private.active_member_context() as context
        where context.workspace_id = p_workspace_id
          and context.member_role = 'owner'
    );
$function$;

create or replace function private.can_access_contact(p_contact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.contacts as contact
        join private.active_member_context() as context
          on context.workspace_id = contact.workspace_id
        where contact.id = p_contact_id
          and (
              context.member_role = 'owner'
              or (
                  not contact.is_protected
                  and contact.commercial_visible_from is not null
              )
          )
    );
$function$;

create or replace function private.can_access_contact_event(
    p_contact_id uuid,
    p_occurred_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.contacts as contact
        join private.active_member_context() as context
          on context.workspace_id = contact.workspace_id
        where contact.id = p_contact_id
          and (
              context.member_role = 'owner'
              or (
                  not contact.is_protected
                  and contact.commercial_visible_from is not null
                  and p_occurred_at >= contact.commercial_visible_from
              )
          )
    );
$function$;

create or replace function private.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.conversations as conversation
        join private.active_member_context() as context
          on context.workspace_id = conversation.workspace_id
        where conversation.id = p_conversation_id
          and (
              context.member_role = 'owner'
              or (
                  conversation.conversation_type = 'group'
                  and conversation.visibility = 'commercial'
                  and conversation.commercial_visible_from is not null
              )
              or (
                  conversation.conversation_type = 'individual'
                  and exists (
                      select 1
                      from public.conversation_participants as participant
                      join public.contact_points as point
                        on point.workspace_id = participant.workspace_id
                       and point.id = participant.contact_point_id
                      join public.contacts as contact
                        on contact.workspace_id = point.workspace_id
                       and contact.id = point.contact_id
                      where participant.workspace_id = conversation.workspace_id
                        and participant.conversation_id = conversation.id
                        and participant.left_at is null
                        and not contact.is_protected
                        and contact.commercial_visible_from is not null
                  )
              )
          )
    );
$function$;

create or replace function private.can_access_conversation_event(
    p_conversation_id uuid,
    p_occurred_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.conversations as conversation
        join private.active_member_context() as context
          on context.workspace_id = conversation.workspace_id
        where conversation.id = p_conversation_id
          and (
              context.member_role = 'owner'
              or (
                  conversation.conversation_type = 'group'
                  and conversation.visibility = 'commercial'
                  and conversation.commercial_visible_from is not null
                  and p_occurred_at >= conversation.commercial_visible_from
              )
              or (
                  conversation.conversation_type = 'individual'
                  and exists (
                      select 1
                      from public.conversation_participants as participant
                      join public.contact_points as point
                        on point.workspace_id = participant.workspace_id
                       and point.id = participant.contact_point_id
                      join public.contacts as contact
                        on contact.workspace_id = point.workspace_id
                       and contact.id = point.contact_id
                      where participant.workspace_id = conversation.workspace_id
                        and participant.conversation_id = conversation.id
                        and participant.left_at is null
                        and not contact.is_protected
                        and contact.commercial_visible_from is not null
                        and p_occurred_at >= contact.commercial_visible_from
                  )
              )
          )
    );
$function$;

create or replace function private.can_access_opportunity(p_opportunity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.opportunities as opportunity
        where opportunity.id = p_opportunity_id
          and private.can_access_contact_event(
              opportunity.contact_id,
              opportunity.created_at
          )
    );
$function$;

create or replace function private.can_access_opportunity_event(
    p_opportunity_id uuid,
    p_occurred_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.opportunities as opportunity
        where opportunity.id = p_opportunity_id
          and private.can_access_contact_event(
              opportunity.contact_id,
              opportunity.created_at
          )
          and private.can_access_contact_event(
              opportunity.contact_id,
              p_occurred_at
          )
    );
$function$;

create or replace function private.can_access_work_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.work_tasks as task
        join private.active_member_context() as context
          on context.workspace_id = task.workspace_id
        where task.id = p_task_id
          and (
              context.member_role = 'owner'
              or (
                  (task.contact_id is null or private.can_access_contact_event(task.contact_id, task.created_at))
                  and (task.opportunity_id is null or private.can_access_opportunity_event(task.opportunity_id, task.created_at))
                  and (task.conversation_id is null or private.can_access_conversation_event(task.conversation_id, task.created_at))
              )
          )
    );
$function$;

create or replace function private.can_access_internal_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
    select exists (
        select 1
        from public.internal_notes as note
        join private.active_member_context() as context
          on context.workspace_id = note.workspace_id
        where note.id = p_note_id
          and (
              context.member_role = 'owner'
              or (
                  (note.contact_id is null or private.can_access_contact_event(note.contact_id, note.created_at))
                  and (note.opportunity_id is null or private.can_access_opportunity_event(note.opportunity_id, note.created_at))
                  and (note.conversation_id is null or private.can_access_conversation_event(note.conversation_id, note.created_at))
              )
          )
    );
$function$;

alter function private.active_member_context() owner to postgres;
alter function private.is_owner_in_workspace(uuid) owner to postgres;
alter function private.can_access_contact(uuid) owner to postgres;
alter function private.can_access_contact_event(uuid, timestamptz) owner to postgres;
alter function private.can_access_conversation(uuid) owner to postgres;
alter function private.can_access_conversation_event(uuid, timestamptz) owner to postgres;
alter function private.can_access_opportunity(uuid) owner to postgres;
alter function private.can_access_opportunity_event(uuid, timestamptz) owner to postgres;
alter function private.can_access_work_task(uuid) owner to postgres;
alter function private.can_access_internal_note(uuid) owner to postgres;

revoke all on function private.active_member_context() from public, anon, authenticated, service_role;
revoke all on function private.is_owner_in_workspace(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_access_contact(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_access_contact_event(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.can_access_conversation(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_access_conversation_event(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.can_access_opportunity(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_access_opportunity_event(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.can_access_work_task(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_access_internal_note(uuid) from public, anon, authenticated, service_role;

grant execute on function private.active_member_context() to authenticated;
grant execute on function private.is_owner_in_workspace(uuid) to authenticated;
grant execute on function private.can_access_contact(uuid) to authenticated;
grant execute on function private.can_access_contact_event(uuid, timestamptz) to authenticated;
grant execute on function private.can_access_conversation(uuid) to authenticated;
grant execute on function private.can_access_conversation_event(uuid, timestamptz) to authenticated;
grant execute on function private.can_access_opportunity(uuid) to authenticated;
grant execute on function private.can_access_opportunity_event(uuid, timestamptz) to authenticated;
grant execute on function private.can_access_work_task(uuid) to authenticated;
grant execute on function private.can_access_internal_note(uuid) to authenticated;

-- The first team-visible epoch starts at deployment time. No historical data is granted.
do $block$
declare
    v_visible_from timestamptz := statement_timestamp();
begin
    update public.contacts
    set commercial_visible_from = v_visible_from
    where not is_protected
      and commercial_visible_from is null;

    update public.contact_points
    set commercial_visible_from = v_visible_from
    where not is_protected
      and commercial_visible_from is null;

    update public.conversations
    set commercial_visible_from = v_visible_from,
        privacy_changed_at = coalesce(privacy_changed_at, v_visible_from)
    where visibility = 'commercial'
      and commercial_visible_from is null;
end;
$block$;

-- Replace owner-only read policies with effective member visibility policies.
drop policy if exists app_users_select_active_owner on public.app_users;
create policy app_users_select_active_member on public.app_users for select to authenticated
using (id in (select context.app_user_id from private.active_member_context() as context));

drop policy if exists workspaces_select_active_owner on public.workspaces;
create policy workspaces_select_active_member on public.workspaces for select to authenticated
using (id in (select context.workspace_id from private.active_member_context() as context));

drop policy if exists workspace_members_select_active_owner on public.workspace_members;
create policy workspace_members_select_active_member on public.workspace_members for select to authenticated
using (workspace_id in (select context.workspace_id from private.active_member_context() as context));

drop policy if exists contacts_select_active_owner on public.contacts;
create policy contacts_select_effective_member on public.contacts for select to authenticated
using (private.can_access_contact(id));

drop policy if exists contact_points_select_active_owner on public.contact_points;
create policy contact_points_select_effective_member on public.contact_points for select to authenticated
using (
    private.is_owner_in_workspace(workspace_id)
    or (contact_id is not null and private.can_access_contact(contact_id))
);

drop policy if exists channel_connections_select_active_owner on public.channel_connections;
create policy channel_connections_select_active_owner on public.channel_connections for select to authenticated
using (private.is_owner_in_workspace(workspace_id));

drop policy if exists conversations_select_active_owner on public.conversations;
create policy conversations_select_effective_member on public.conversations for select to authenticated
using (private.can_access_conversation(id));

drop policy if exists conversation_participants_select_active_owner on public.conversation_participants;
create policy conversation_participants_select_effective_member on public.conversation_participants for select to authenticated
using (private.can_access_conversation(conversation_id));

drop policy if exists messages_select_active_owner on public.messages;
create policy messages_select_effective_member on public.messages for select to authenticated
using (private.can_access_conversation_event(conversation_id, occurred_at));

drop policy if exists attachments_select_active_owner on public.attachments;
create policy attachments_select_effective_member on public.attachments for select to authenticated
using (
    exists (
        select 1
        from public.messages as message
        where message.id = attachments.message_id
          and private.can_access_conversation_event(message.conversation_id, message.occurred_at)
    )
);

drop policy if exists conversation_assignments_select_active_owner on public.conversation_assignments;
create policy conversation_assignments_select_effective_member on public.conversation_assignments for select to authenticated
using (private.can_access_conversation_event(conversation_id, assigned_at));

drop policy if exists pipeline_stages_select_active_owner on public.pipeline_stages;
create policy pipeline_stages_select_active_member on public.pipeline_stages for select to authenticated
using (workspace_id in (select context.workspace_id from private.active_member_context() as context));

drop policy if exists opportunities_select_active_owner on public.opportunities;
create policy opportunities_select_effective_member on public.opportunities for select to authenticated
using (private.can_access_opportunity(id));

drop policy if exists opportunity_conversations_select_active_owner on public.opportunity_conversations;
create policy opportunity_conversations_select_effective_member on public.opportunity_conversations for select to authenticated
using (
    private.can_access_opportunity(opportunity_id)
    and private.can_access_conversation(conversation_id)
);

drop policy if exists pipeline_history_select_active_owner on public.pipeline_history;
create policy pipeline_history_select_effective_member on public.pipeline_history for select to authenticated
using (private.can_access_opportunity_event(opportunity_id, changed_at));

drop policy if exists work_tasks_select_active_owner on public.work_tasks;
create policy work_tasks_select_effective_member on public.work_tasks for select to authenticated
using (private.can_access_work_task(id));

drop policy if exists internal_notes_select_active_owner on public.internal_notes;
create policy internal_notes_select_effective_member on public.internal_notes for select to authenticated
using (private.can_access_internal_note(id));

drop policy if exists audit_events_select_active_owner on public.audit_events;
create policy audit_events_select_active_owner on public.audit_events for select to authenticated
using (private.is_owner_in_workspace(workspace_id));

drop policy if exists owner_member_read_states_all on public.conversation_read_states;
drop policy if exists conversation_read_states_select_own on public.conversation_read_states;
create policy conversation_read_states_select_own on public.conversation_read_states for select to authenticated
using (
    member_id in (select context.member_id from private.active_member_context() as context)
    and private.can_access_conversation(conversation_id)
);

revoke insert, update, delete, truncate, references, trigger
on public.conversation_read_states from authenticated, service_role;
grant select on public.conversation_read_states to authenticated;

create or replace function public.mark_conversation_unread(
    p_conversation_id uuid,
    p_unread boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_member_id uuid;
    v_now timestamptz := statement_timestamp();
begin
    select conversation.workspace_id
    into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id;

    select context.member_id
    into v_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id;

    if v_member_id is null
       or not private.can_access_conversation(p_conversation_id) then
        raise exception 'conversation_not_available' using errcode = '42501';
    end if;

    insert into public.conversation_read_states (
        workspace_id,
        conversation_id,
        member_id,
        is_unread,
        marked_unread_at,
        last_read_at,
        created_at,
        updated_at
    )
    values (
        v_workspace_id,
        p_conversation_id,
        v_member_id,
        p_unread,
        case when p_unread then v_now else null end,
        v_now,
        v_now,
        v_now
    )
    on conflict (workspace_id, conversation_id, member_id)
    do update set
        is_unread = excluded.is_unread,
        marked_unread_at = case when excluded.is_unread then v_now else null end,
        last_read_at = case
            when excluded.is_unread then public.conversation_read_states.last_read_at
            else v_now
        end,
        updated_at = v_now;

    return jsonb_build_object('success', true, 'is_unread', p_unread);
end;
$function$;

alter function public.mark_conversation_unread(uuid, boolean) owner to postgres;
revoke all on function public.mark_conversation_unread(uuid, boolean) from public, anon, service_role;
grant execute on function public.mark_conversation_unread(uuid, boolean) to authenticated;

create or replace function public.set_contact_team_visibility(
    p_contact_id uuid,
    p_team_visible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_changed_at timestamptz := statement_timestamp();
    v_conversation_ids uuid[];
begin
    select contact.workspace_id
    into v_workspace_id
    from public.contacts as contact
    where contact.id = p_contact_id
    for update;

    select context.member_id
    into v_owner_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id
      and context.member_role = 'owner';

    if v_owner_member_id is null then
        raise exception 'contact_visibility_not_authorized' using errcode = '42501';
    end if;

    select coalesce(array_agg(distinct conversation.id), '{}'::uuid[])
    into v_conversation_ids
    from public.conversations as conversation
    join public.conversation_participants as participant
      on participant.workspace_id = conversation.workspace_id
     and participant.conversation_id = conversation.id
     and participant.left_at is null
    join public.contact_points as point
      on point.workspace_id = participant.workspace_id
     and point.id = participant.contact_point_id
    where conversation.workspace_id = v_workspace_id
      and conversation.conversation_type = 'individual'
      and point.contact_id = p_contact_id;

    update public.contacts
    set is_protected = not p_team_visible,
        protected_at = case when p_team_visible then protected_at else v_changed_at end,
        commercial_visible_from = case when p_team_visible then v_changed_at else null end
    where id = p_contact_id
      and workspace_id = v_workspace_id;

    update public.contact_points
    set is_protected = not p_team_visible,
        protected_at = case when p_team_visible then protected_at else v_changed_at end,
        commercial_visible_from = case when p_team_visible then v_changed_at else null end
    where workspace_id = v_workspace_id
      and contact_id = p_contact_id;

    update public.conversations
    set visibility = case when p_team_visible then 'commercial' else 'owner_only' end,
        commercial_visible_from = case when p_team_visible then v_changed_at else null end,
        privacy_changed_at = v_changed_at
    where id = any(v_conversation_ids);

    if not p_team_visible then
        update public.conversation_assignments as assignment
        set ended_at = v_changed_at,
            ended_by_member_id = v_owner_member_id,
            end_reason = 'contact_became_owner_only'
        from public.workspace_members as assigned_member
        where assignment.workspace_id = v_workspace_id
          and assignment.conversation_id = any(v_conversation_ids)
          and assignment.ended_at is null
          and assigned_member.workspace_id = assignment.workspace_id
          and assigned_member.id = assignment.member_id
          and assigned_member.role = 'attendant';
    end if;

    insert into public.audit_events (
        workspace_id,
        actor_type,
        actor_member_id,
        action,
        target_type,
        target_id,
        result,
        metadata,
        occurred_at,
        recorded_at
    )
    values (
        v_workspace_id,
        'member',
        v_owner_member_id,
        case when p_team_visible then 'contact.team_visibility_enabled' else 'contact.owner_only_enabled' end,
        'contact',
        p_contact_id,
        'success',
        jsonb_build_object('commercial_visible_from', case when p_team_visible then v_changed_at else null end),
        v_changed_at,
        v_changed_at
    );

    return jsonb_build_object(
        'success', true,
        'team_visible', p_team_visible,
        'commercial_visible_from', case when p_team_visible then v_changed_at else null end
    );
end;
$function$;

create or replace function public.set_group_team_visibility(
    p_conversation_id uuid,
    p_team_visible boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_workspace_id uuid;
    v_owner_member_id uuid;
    v_changed_at timestamptz := statement_timestamp();
begin
    select conversation.workspace_id
    into v_workspace_id
    from public.conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.conversation_type = 'group'
    for update;

    select context.member_id
    into v_owner_member_id
    from private.active_member_context() as context
    where context.workspace_id = v_workspace_id
      and context.member_role = 'owner';

    if v_owner_member_id is null then
        raise exception 'group_visibility_not_authorized' using errcode = '42501';
    end if;

    update public.conversations
    set visibility = case when p_team_visible then 'commercial' else 'owner_only' end,
        commercial_visible_from = case when p_team_visible then v_changed_at else null end,
        privacy_changed_at = v_changed_at
    where id = p_conversation_id
      and workspace_id = v_workspace_id;

    insert into public.audit_events (
        workspace_id,
        actor_type,
        actor_member_id,
        action,
        target_type,
        target_id,
        result,
        metadata,
        occurred_at,
        recorded_at
    )
    values (
        v_workspace_id,
        'member',
        v_owner_member_id,
        case when p_team_visible then 'group.team_visibility_enabled' else 'group.owner_only_enabled' end,
        'conversation',
        p_conversation_id,
        'success',
        jsonb_build_object('commercial_visible_from', case when p_team_visible then v_changed_at else null end),
        v_changed_at,
        v_changed_at
    );

    return jsonb_build_object(
        'success', true,
        'team_visible', p_team_visible,
        'commercial_visible_from', case when p_team_visible then v_changed_at else null end
    );
end;
$function$;

alter function public.set_contact_team_visibility(uuid, boolean) owner to postgres;
alter function public.set_group_team_visibility(uuid, boolean) owner to postgres;
revoke all on function public.set_contact_team_visibility(uuid, boolean) from public, anon, service_role;
revoke all on function public.set_group_team_visibility(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_contact_team_visibility(uuid, boolean) to authenticated;
grant execute on function public.set_group_team_visibility(uuid, boolean) to authenticated;
