-- ImobFlux Sprint 10: contacts, external identities, and channel connections.

create table public.contacts (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    display_name text not null,
    classification text not null,
    operational_status text not null,
    is_protected boolean default false not null,
    commercial_visible_from timestamptz,
    protected_at timestamptz,
    inactive_at timestamptz,
    archived_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_contacts primary key (id),
    constraint uq_contacts_workspace_id_id
        unique (workspace_id, id),
    constraint fk_contacts_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint ck_contacts_display_name_nonempty
        check (btrim(display_name) <> ''),
    constraint ck_contacts_classification
        check (classification in ('person', 'lead', 'client')),
    constraint ck_contacts_operational_status
        check (operational_status in ('active', 'inactive')),
    constraint ck_contacts_inactivation
        check (
            (operational_status = 'active' and inactive_at is null)
            or (operational_status = 'inactive' and inactive_at is not null)
        ),
    constraint ck_contacts_protection
        check (not is_protected or protected_at is not null),
    constraint ck_contacts_timestamps
        check (
            updated_at >= created_at
            and (
                commercial_visible_from is null
                or commercial_visible_from >= created_at
            )
            and (protected_at is null or protected_at >= created_at)
            and (inactive_at is null or inactive_at >= created_at)
            and (archived_at is null or archived_at >= created_at)
        )
);

create index idx_contacts_active_list
    on public.contacts (workspace_id, archived_at, operational_status);

create index idx_contacts_privacy
    on public.contacts (workspace_id, is_protected);

create index idx_contacts_display_name_normalized
    on public.contacts (workspace_id, lower(display_name));

create table public.contact_points (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    contact_id uuid,
    point_type text not null,
    normalized_value text not null,
    display_value text,
    external_display_name text,
    operational_status text not null,
    is_protected boolean default false not null,
    commercial_visible_from timestamptz,
    protected_at timestamptz,
    inactive_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_contact_points primary key (id),
    constraint uq_contact_points_workspace_id_id
        unique (workspace_id, id),
    constraint uq_contact_points_normalized_identity
        unique (workspace_id, point_type, normalized_value),
    constraint fk_contact_points_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_contact_points_contact
        foreign key (workspace_id, contact_id)
        references public.contacts (workspace_id, id)
        on delete restrict,
    constraint ck_contact_points_type
        check (point_type in ('phone', 'external_identifier')),
    constraint ck_contact_points_normalized_value_nonempty
        check (btrim(normalized_value) <> ''),
    constraint ck_contact_points_display_value_nonempty
        check (display_value is null or btrim(display_value) <> ''),
    constraint ck_contact_points_external_name_nonempty
        check (
            external_display_name is null
            or btrim(external_display_name) <> ''
        ),
    constraint ck_contact_points_operational_status
        check (operational_status in ('active', 'inactive')),
    constraint ck_contact_points_inactivation
        check (
            (operational_status = 'active' and inactive_at is null)
            or (operational_status = 'inactive' and inactive_at is not null)
        ),
    constraint ck_contact_points_protection
        check (not is_protected or protected_at is not null),
    constraint ck_contact_points_timestamps
        check (
            updated_at >= created_at
            and (
                commercial_visible_from is null
                or commercial_visible_from >= created_at
            )
            and (protected_at is null or protected_at >= created_at)
            and (inactive_at is null or inactive_at >= created_at)
        )
);

create index idx_contact_points_contact
    on public.contact_points (workspace_id, contact_id, operational_status)
    where contact_id is not null;

create index idx_contact_points_privacy
    on public.contact_points (workspace_id, is_protected);

create table public.channel_connections (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    provider text not null,
    external_account_id text not null,
    external_phone_normalized text,
    display_name text,
    credential_reference text,
    status text not null,
    activated_at timestamptz,
    paused_at timestamptz,
    disconnected_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_channel_connections primary key (id),
    constraint uq_channel_connections_workspace_id_id
        unique (workspace_id, id),
    constraint uq_channel_connections_external_account
        unique (provider, external_account_id),
    constraint fk_channel_connections_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint ck_channel_connections_provider
        check (provider in ('whatsapp')),
    constraint ck_channel_connections_status
        check (
            status in (
                'configured',
                'active',
                'paused',
                'disconnected',
                'replaced'
            )
        ),
    constraint ck_channel_connections_external_account_nonempty
        check (btrim(external_account_id) <> ''),
    constraint ck_channel_connections_phone_nonempty
        check (
            external_phone_normalized is null
            or btrim(external_phone_normalized) <> ''
        ),
    constraint ck_channel_connections_display_name_nonempty
        check (display_name is null or btrim(display_name) <> ''),
    constraint ck_channel_connections_credential_reference_nonempty
        check (
            credential_reference is null
            or btrim(credential_reference) <> ''
        ),
    constraint ck_channel_connections_active_phone
        check (
            status <> 'active'
            or (
                provider = 'whatsapp'
                and external_phone_normalized is not null
            )
        ),
    constraint ck_channel_connections_lifecycle
        check (
            (
                status = 'configured'
                and activated_at is null
                and paused_at is null
                and disconnected_at is null
            )
            or (
                status = 'active'
                and activated_at is not null
                and paused_at is null
                and disconnected_at is null
            )
            or (
                status = 'paused'
                and activated_at is not null
                and paused_at is not null
                and disconnected_at is null
            )
            or (
                status in ('disconnected', 'replaced')
                and paused_at is null
                and disconnected_at is not null
            )
        ),
    constraint ck_channel_connections_timestamps
        check (
            updated_at >= created_at
            and (activated_at is null or activated_at >= created_at)
            and (paused_at is null or paused_at >= activated_at)
            and (disconnected_at is null or disconnected_at >= created_at)
        )
);

create unique index uq_channel_connections_active_provider_per_workspace
    on public.channel_connections (workspace_id, provider)
    where status = 'active';

create index idx_channel_connections_workspace_status
    on public.channel_connections (workspace_id, status);
