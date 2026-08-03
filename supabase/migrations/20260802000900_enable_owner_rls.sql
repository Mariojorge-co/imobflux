-- ImobFlux Sprint 13: read-only RLS for the initial individual OWNER.
-- Business writes remain revoked until each vertical module adds audited flows.

create schema private;

revoke all privileges on schema private
from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

create function private.active_owner_context()
returns table (
    app_user_id uuid,
    member_id uuid,
    workspace_id uuid
)
language sql
stable
security definer
set search_path = ''
as $function$
    select
        app_user.id as app_user_id,
        member.id as member_id,
        workspace.id as workspace_id
    from public.app_users as app_user
    join public.workspace_members as member
      on member.user_id = app_user.id
    join public.workspaces as workspace
      on workspace.id = member.workspace_id
    where app_user.auth_user_id = (select auth.uid())
      and app_user.status = 'active'
      and member.status = 'active'
      and member.role = 'owner'
      and workspace.status = 'active';
$function$;

alter function private.active_owner_context() owner to postgres;

revoke all privileges on function private.active_owner_context()
from public, anon, authenticated, service_role;

grant execute on function private.active_owner_context()
to authenticated;

revoke all privileges on table
    public.app_users,
    public.workspaces,
    public.workspace_members,
    public.contacts,
    public.contact_points,
    public.channel_connections,
    public.conversations,
    public.conversation_participants,
    public.messages,
    public.attachments,
    public.conversation_assignments,
    public.pipeline_stages,
    public.opportunities,
    public.opportunity_conversations,
    public.pipeline_history,
    public.work_tasks,
    public.internal_notes,
    public.audit_events
from public, anon, authenticated;

grant select on table
    public.app_users,
    public.workspaces,
    public.workspace_members,
    public.contacts,
    public.contact_points,
    public.channel_connections,
    public.conversations,
    public.conversation_participants,
    public.messages,
    public.attachments,
    public.conversation_assignments,
    public.pipeline_stages,
    public.opportunities,
    public.opportunity_conversations,
    public.pipeline_history,
    public.work_tasks,
    public.internal_notes,
    public.audit_events
to authenticated;

alter table public.app_users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_points enable row level security;
alter table public.channel_connections enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.conversation_assignments enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_conversations enable row level security;
alter table public.pipeline_history enable row level security;
alter table public.work_tasks enable row level security;
alter table public.internal_notes enable row level security;
alter table public.audit_events enable row level security;

create policy app_users_select_active_owner
on public.app_users
for select
to authenticated
using (
    status = 'active'
    and id in (
        select owner_context.app_user_id
        from private.active_owner_context() as owner_context
    )
);

create policy workspaces_select_active_owner
on public.workspaces
for select
to authenticated
using (
    status = 'active'
    and id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy workspace_members_select_active_owner
on public.workspace_members
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy contacts_select_active_owner
on public.contacts
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy contact_points_select_active_owner
on public.contact_points
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy channel_connections_select_active_owner
on public.channel_connections
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy conversations_select_active_owner
on public.conversations
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy conversation_participants_select_active_owner
on public.conversation_participants
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy messages_select_active_owner
on public.messages
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy attachments_select_active_owner
on public.attachments
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy conversation_assignments_select_active_owner
on public.conversation_assignments
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy pipeline_stages_select_active_owner
on public.pipeline_stages
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy opportunities_select_active_owner
on public.opportunities
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy opportunity_conversations_select_active_owner
on public.opportunity_conversations
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy pipeline_history_select_active_owner
on public.pipeline_history
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy work_tasks_select_active_owner
on public.work_tasks
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy internal_notes_select_active_owner
on public.internal_notes
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);

create policy audit_events_select_active_owner
on public.audit_events
for select
to authenticated
using (
    workspace_id in (
        select owner_context.workspace_id
        from private.active_owner_context() as owner_context
    )
);
