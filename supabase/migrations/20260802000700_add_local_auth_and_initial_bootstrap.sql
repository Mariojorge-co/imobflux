-- ImobFlux Sprint 12: local Auth integration and one-time initial bootstrap.
-- RLS and policies remain intentionally deferred.

alter table public.app_users
    add constraint fk_app_users_auth_user
        foreign key (auth_user_id)
        references auth.users (id)
        on delete set null
        not valid;

alter table public.app_users
    validate constraint fk_app_users_auth_user;

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
from anon, authenticated;

create function public.bootstrap_initial_workspace(
    p_auth_user_id uuid,
    p_display_name text,
    p_workspace_name text,
    p_timezone text
)
returns table (
    app_user_id uuid,
    workspace_id uuid,
    workspace_member_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_app_user_id uuid;
    v_workspace_id uuid;
    v_workspace_member_id uuid;
    v_occurred_at timestamptz := pg_catalog.statement_timestamp();
begin
    perform pg_catalog.pg_advisory_xact_lock(3104776296942529792::bigint);

    if exists (select 1 from public.workspaces) then
        raise exception 'Initial bootstrap is closed'
            using errcode = '55000';
    end if;

    if p_auth_user_id is null then
        raise exception 'Auth user is required'
            using errcode = '22004';
    end if;

    if p_display_name is null or pg_catalog.btrim(p_display_name) = '' then
        raise exception 'Display name is required'
            using errcode = '22023';
    end if;

    if p_workspace_name is null or pg_catalog.btrim(p_workspace_name) = '' then
        raise exception 'Workspace name is required'
            using errcode = '22023';
    end if;

    if p_timezone is null or pg_catalog.btrim(p_timezone) = '' then
        raise exception 'Timezone is required'
            using errcode = '22023';
    end if;

    insert into public.app_users (
        auth_user_id,
        display_name,
        status
    )
    values (
        p_auth_user_id,
        pg_catalog.btrim(p_display_name),
        'active'
    )
    returning id into v_app_user_id;

    insert into public.workspaces (
        name,
        status,
        timezone
    )
    values (
        pg_catalog.btrim(p_workspace_name),
        'active',
        pg_catalog.btrim(p_timezone)
    )
    returning id into v_workspace_id;

    insert into public.workspace_members (
        workspace_id,
        user_id,
        role,
        status,
        activated_at
    )
    values (
        v_workspace_id,
        v_app_user_id,
        'owner',
        'active',
        v_occurred_at
    )
    returning id into v_workspace_member_id;

    insert into public.audit_events (
        workspace_id,
        actor_type,
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
        'system',
        'bootstrap.completed',
        'workspace',
        v_workspace_id,
        'success',
        pg_catalog.jsonb_build_object(
            'app_user_id', v_app_user_id,
            'workspace_member_id', v_workspace_member_id
        ),
        v_occurred_at,
        v_occurred_at
    );

    return query
    select
        v_app_user_id,
        v_workspace_id,
        v_workspace_member_id;
end;
$function$;

revoke execute on function public.bootstrap_initial_workspace(
    uuid,
    text,
    text,
    text
) from public;

revoke execute on function public.bootstrap_initial_workspace(
    uuid,
    text,
    text,
    text
) from anon;

revoke execute on function public.bootstrap_initial_workspace(
    uuid,
    text,
    text,
    text
) from authenticated;

grant execute on function public.bootstrap_initial_workspace(
    uuid,
    text,
    text,
    text
) to service_role;
