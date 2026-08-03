-- ImobFlux Sprint 10: durable identities, workspace boundary, and memberships.
-- RLS and auth.users integration are intentionally deferred.

create table public.app_users (
    id uuid default gen_random_uuid() not null,
    auth_user_id uuid,
    display_name text not null,
    status text not null,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    deactivated_at timestamptz,

    constraint pk_app_users primary key (id),
    constraint uq_app_users_auth_user unique (auth_user_id),
    constraint ck_app_users_display_name_nonempty
        check (btrim(display_name) <> ''),
    constraint ck_app_users_status
        check (status in ('active', 'inactive')),
    constraint ck_app_users_deactivation
        check (
            (status = 'active' and deactivated_at is null)
            or (status = 'inactive' and deactivated_at is not null)
        ),
    constraint ck_app_users_timestamps
        check (
            updated_at >= created_at
            and (deactivated_at is null or deactivated_at >= created_at)
        )
);

create table public.workspaces (
    id uuid default gen_random_uuid() not null,
    name text not null,
    status text not null,
    timezone text not null,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    closed_at timestamptz,

    constraint pk_workspaces primary key (id),
    constraint ck_workspaces_name_nonempty
        check (btrim(name) <> ''),
    constraint ck_workspaces_timezone_nonempty
        check (btrim(timezone) <> ''),
    constraint ck_workspaces_status
        check (status in ('active', 'suspended', 'closed')),
    constraint ck_workspaces_closure
        check (
            (status = 'closed' and closed_at is not null)
            or (status <> 'closed' and closed_at is null)
        ),
    constraint ck_workspaces_timestamps
        check (
            updated_at >= created_at
            and (closed_at is null or closed_at >= created_at)
        )
);

create table public.workspace_members (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    user_id uuid,
    invited_email_normalized text,
    role text not null,
    status text not null,
    invited_by_member_id uuid,
    invited_at timestamptz,
    invitation_expires_at timestamptz,
    activated_at timestamptz,
    suspended_at timestamptz,
    removed_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_workspace_members primary key (id),
    constraint uq_workspace_members_workspace_id_id
        unique (workspace_id, id),
    constraint fk_workspace_members_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_workspace_members_user
        foreign key (user_id)
        references public.app_users (id)
        on delete restrict,
    constraint fk_workspace_members_invited_by
        foreign key (workspace_id, invited_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_workspace_members_role
        check (role in ('owner', 'attendant')),
    constraint ck_workspace_members_status
        check (status in ('invited', 'active', 'suspended', 'removed')),
    constraint ck_workspace_members_invited_email_nonempty
        check (
            invited_email_normalized is null
            or btrim(invited_email_normalized) <> ''
        ),
    constraint ck_workspace_members_identity
        check (user_id is not null or invited_email_normalized is not null),
    constraint ck_workspace_members_lifecycle
        check (
            (
                status = 'invited'
                and invited_email_normalized is not null
                and invited_at is not null
                and activated_at is null
                and suspended_at is null
                and removed_at is null
            )
            or (
                status = 'active'
                and user_id is not null
                and activated_at is not null
                and suspended_at is null
                and removed_at is null
            )
            or (
                status = 'suspended'
                and user_id is not null
                and activated_at is not null
                and suspended_at is not null
                and removed_at is null
            )
            or (
                status = 'removed'
                and removed_at is not null
                and (
                    (
                        activated_at is null
                        and invited_email_normalized is not null
                        and invited_at is not null
                        and suspended_at is null
                    )
                    or (
                        activated_at is not null
                        and user_id is not null
                    )
                )
            )
        ),
    constraint ck_workspace_members_invitation_expiry
        check (
            invitation_expires_at is null
            or (
                invited_at is not null
                and invitation_expires_at > invited_at
            )
        ),
    constraint ck_workspace_members_timestamps
        check (
            updated_at >= created_at
            and (invited_at is null or invited_at >= created_at)
            and (
                activated_at is null
                or activated_at >= coalesce(invited_at, created_at)
            )
            and (
                suspended_at is null
                or suspended_at >= activated_at
            )
            and (
                removed_at is null
                or removed_at >= coalesce(
                    suspended_at,
                    activated_at,
                    invited_at,
                    created_at
                )
            )
        )
);

create unique index uq_workspace_members_user_non_removed
    on public.workspace_members (workspace_id, user_id)
    where user_id is not null and status <> 'removed';

create unique index uq_workspace_members_open_invitation
    on public.workspace_members (workspace_id, invited_email_normalized)
    where invited_email_normalized is not null and status = 'invited';

-- This stricter invariant also guarantees at most one active OWNER without a
-- redundant second index. Ownership transfer remains a future transaction.
create unique index uq_workspace_members_owner_non_removed
    on public.workspace_members (workspace_id)
    where role = 'owner' and status <> 'removed';

create index idx_workspace_members_authorization
    on public.workspace_members (workspace_id, status, role);

create index idx_workspace_members_user_status
    on public.workspace_members (user_id, status)
    where user_id is not null;
