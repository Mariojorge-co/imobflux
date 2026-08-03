-- ImobFlux Sprint 10.1: corrective integrity hardening.
-- Keeps the 18-table model unchanged and adds no business automation.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
    new.updated_at = pg_catalog.statement_timestamp();
    return new;
end;
$function$;

create trigger trg_pipeline_history_prevent_truncate
before truncate on public.pipeline_history
for each statement execute function public.prevent_append_only_mutation();

create trigger trg_audit_events_prevent_truncate
before truncate on public.audit_events
for each statement execute function public.prevent_append_only_mutation();

alter table public.workspace_members
    add constraint ck_workspace_members_invitation_author
        check (
            invited_by_member_id is not null
            or (
                role = 'owner'
                and user_id is not null
                and activated_at is not null
                and invited_email_normalized is null
                and invited_at is null
                and invitation_expires_at is null
            )
        ),
    add constraint ck_workspace_members_invitation_author_not_self
        check (
            invited_by_member_id is null
            or invited_by_member_id <> id
        );

alter table public.app_users
    drop constraint uq_app_users_auth_user;

create unique index uq_app_users_auth_user
    on public.app_users (auth_user_id)
    where auth_user_id is not null;
