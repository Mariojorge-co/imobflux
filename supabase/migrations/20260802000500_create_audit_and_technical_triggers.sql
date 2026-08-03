-- ImobFlux Sprint 10: permanent audit storage and technical updated_at support.
-- No generic audit trigger, RLS policy, or business automation is created.

create table public.audit_events (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    actor_type text not null,
    actor_member_id uuid,
    action text not null,
    target_type text not null,
    target_id uuid,
    result text not null,
    correlation_id uuid,
    metadata jsonb default '{}'::jsonb not null,
    occurred_at timestamptz not null,
    recorded_at timestamptz default now() not null,

    constraint pk_audit_events primary key (id),
    constraint fk_audit_events_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_audit_events_actor_member
        foreign key (workspace_id, actor_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_audit_events_actor
        check (
            (actor_type = 'member' and actor_member_id is not null)
            or (actor_type = 'system' and actor_member_id is null)
        ),
    constraint ck_audit_events_action_nonempty
        check (btrim(action) <> ''),
    constraint ck_audit_events_target_type_nonempty
        check (btrim(target_type) <> ''),
    constraint ck_audit_events_result
        check (result in ('success', 'denied', 'failed')),
    constraint ck_audit_events_metadata_object
        check (jsonb_typeof(metadata) = 'object'),
    constraint ck_audit_events_timestamps
        check (recorded_at >= occurred_at)
);

create index idx_audit_events_workspace_cursor
    on public.audit_events (workspace_id, occurred_at desc, id desc);

create index idx_audit_events_target
    on public.audit_events (
        workspace_id,
        target_type,
        target_id,
        occurred_at desc
    );

create index idx_audit_events_actor
    on public.audit_events (
        workspace_id,
        actor_member_id,
        occurred_at desc
    )
    where actor_member_id is not null;

create index idx_audit_events_correlation
    on public.audit_events (workspace_id, correlation_id)
    where correlation_id is not null;

create function public.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
    raise exception '% is append-only', tg_table_name
        using errcode = '55000';
    return null;
end;
$function$;

create trigger trg_pipeline_history_prevent_mutation
before update or delete on public.pipeline_history
for each row execute function public.prevent_append_only_mutation();

create trigger trg_audit_events_prevent_mutation
before update or delete on public.audit_events
for each row execute function public.prevent_append_only_mutation();

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
    new.updated_at = pg_catalog.now();
    return new;
end;
$function$;

create trigger trg_app_users_set_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

create trigger trg_workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.set_updated_at();

create trigger trg_workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function public.set_updated_at();

create trigger trg_contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

create trigger trg_contact_points_set_updated_at
before update on public.contact_points
for each row execute function public.set_updated_at();

create trigger trg_channel_connections_set_updated_at
before update on public.channel_connections
for each row execute function public.set_updated_at();

create trigger trg_conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

create trigger trg_conversation_participants_set_updated_at
before update on public.conversation_participants
for each row execute function public.set_updated_at();

create trigger trg_pipeline_stages_set_updated_at
before update on public.pipeline_stages
for each row execute function public.set_updated_at();

create trigger trg_opportunities_set_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

create trigger trg_work_tasks_set_updated_at
before update on public.work_tasks
for each row execute function public.set_updated_at();

create trigger trg_internal_notes_set_updated_at
before update on public.internal_notes
for each row execute function public.set_updated_at();
