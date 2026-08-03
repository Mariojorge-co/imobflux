-- ImobFlux Sprint 12: least-privilege access for the isolated admin client.
-- The service_role remains the only caller of the SECURITY INVOKER bootstrap.

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
from service_role;

grant select on table
    public.app_users,
    public.workspaces,
    public.workspace_members
to service_role;

grant insert on table
    public.app_users,
    public.workspaces,
    public.workspace_members,
    public.audit_events
to service_role;
