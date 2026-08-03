-- ImobFlux Sprint 10: conversations, participants, messages, attachments,
-- and operational assignments. Privacy fields are structural; RLS is deferred.

create table public.conversations (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    channel_connection_id uuid not null,
    external_thread_id text not null,
    conversation_type text not null,
    operational_status text not null,
    visibility text not null,
    commercial_visible_from timestamptz,
    subject text,
    started_at timestamptz not null,
    privacy_changed_at timestamptz,
    archived_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_conversations primary key (id),
    constraint uq_conversations_workspace_id_id
        unique (workspace_id, id),
    constraint uq_conversations_workspace_connection_id
        unique (workspace_id, channel_connection_id, id),
    constraint uq_conversations_external_thread
        unique (channel_connection_id, external_thread_id),
    constraint fk_conversations_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_conversations_channel_connection
        foreign key (workspace_id, channel_connection_id)
        references public.channel_connections (workspace_id, id)
        on delete restrict,
    constraint ck_conversations_external_thread_nonempty
        check (btrim(external_thread_id) <> ''),
    constraint ck_conversations_type
        check (conversation_type in ('individual', 'group')),
    constraint ck_conversations_operational_status
        check (operational_status in ('active', 'archived')),
    constraint ck_conversations_visibility
        check (visibility in ('commercial', 'owner_only')),
    constraint ck_conversations_subject_nonempty
        check (subject is null or btrim(subject) <> ''),
    constraint ck_conversations_archiving
        check (
            (operational_status = 'active' and archived_at is null)
            or (
                operational_status = 'archived'
                and archived_at is not null
            )
        ),
    constraint ck_conversations_timestamps
        check (
            updated_at >= created_at
            and (
                commercial_visible_from is null
                or commercial_visible_from >= started_at
            )
            and (
                privacy_changed_at is null
                or privacy_changed_at >= created_at
            )
            and (archived_at is null or archived_at >= created_at)
        )
);

create index idx_conversations_accessible_list
    on public.conversations (
        workspace_id,
        visibility,
        operational_status,
        created_at desc,
        id desc
    );

create index idx_conversations_privacy_cutoff
    on public.conversations (workspace_id, commercial_visible_from);

create index idx_conversations_archived
    on public.conversations (workspace_id, archived_at);

create table public.conversation_participants (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    conversation_id uuid not null,
    contact_point_id uuid,
    workspace_member_id uuid,
    external_display_name text,
    first_seen_at timestamptz not null,
    last_seen_at timestamptz,
    left_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    constraint pk_conversation_participants primary key (id),
    constraint fk_conversation_participants_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_conversation_participants_conversation
        foreign key (workspace_id, conversation_id)
        references public.conversations (workspace_id, id)
        on delete restrict,
    constraint fk_conversation_participants_contact_point
        foreign key (workspace_id, contact_point_id)
        references public.contact_points (workspace_id, id)
        on delete restrict,
    constraint fk_conversation_participants_member
        foreign key (workspace_id, workspace_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_conversation_participants_identity
        check (num_nonnulls(contact_point_id, workspace_member_id) = 1),
    constraint ck_conversation_participants_external_name_nonempty
        check (
            external_display_name is null
            or btrim(external_display_name) <> ''
        ),
    constraint ck_conversation_participants_timestamps
        check (
            updated_at >= created_at
            and (
                last_seen_at is null
                or last_seen_at >= first_seen_at
            )
            and (left_at is null or left_at >= first_seen_at)
        )
);

create unique index uq_conversation_participants_active_contact_point
    on public.conversation_participants (conversation_id, contact_point_id)
    where contact_point_id is not null and left_at is null;

create unique index uq_conversation_participants_active_member
    on public.conversation_participants (conversation_id, workspace_member_id)
    where workspace_member_id is not null and left_at is null;

create index idx_conversation_participants_conversation
    on public.conversation_participants (
        workspace_id,
        conversation_id,
        left_at
    );

create index idx_conversation_participants_contact_point
    on public.conversation_participants (
        workspace_id,
        contact_point_id,
        left_at
    )
    where contact_point_id is not null;

create index idx_conversation_participants_member
    on public.conversation_participants (
        workspace_id,
        workspace_member_id,
        left_at
    )
    where workspace_member_id is not null;

create table public.messages (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    channel_connection_id uuid not null,
    conversation_id uuid not null,
    external_message_id text,
    client_idempotency_key uuid,
    direction text not null,
    origin text not null,
    sender_contact_point_id uuid,
    internal_author_member_id uuid,
    text_content text,
    status text not null,
    occurred_at timestamptz not null,
    external_created_at timestamptz,
    received_at timestamptz,
    status_updated_at timestamptz,
    created_at timestamptz default now() not null,

    constraint pk_messages primary key (id),
    constraint uq_messages_workspace_id_id
        unique (workspace_id, id),
    constraint fk_messages_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_messages_channel_connection
        foreign key (workspace_id, channel_connection_id)
        references public.channel_connections (workspace_id, id)
        on delete restrict,
    constraint fk_messages_conversation
        foreign key (
            workspace_id,
            channel_connection_id,
            conversation_id
        )
        references public.conversations (
            workspace_id,
            channel_connection_id,
            id
        )
        on delete restrict,
    constraint fk_messages_sender_contact_point
        foreign key (workspace_id, sender_contact_point_id)
        references public.contact_points (workspace_id, id)
        on delete restrict,
    constraint fk_messages_internal_author
        foreign key (workspace_id, internal_author_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_messages_external_id_nonempty
        check (
            external_message_id is null
            or btrim(external_message_id) <> ''
        ),
    constraint ck_messages_text_content_nonempty
        check (text_content is null or btrim(text_content) <> ''),
    constraint ck_messages_direction
        check (direction in ('incoming', 'outgoing')),
    constraint ck_messages_origin
        check (origin in ('crm', 'whatsapp')),
    constraint ck_messages_status
        check (
            status in (
                'received',
                'queued',
                'sent',
                'delivered',
                'read',
                'failed'
            )
        ),
    constraint ck_messages_crm_origin
        check (
            origin <> 'crm'
            or (
                direction = 'outgoing'
                and internal_author_member_id is not null
                and client_idempotency_key is not null
                and sender_contact_point_id is null
            )
        ),
    constraint ck_messages_whatsapp_origin
        check (
            origin <> 'whatsapp'
            or (
                internal_author_member_id is null
                and external_message_id is not null
                and external_created_at is not null
                and received_at is not null
            )
        ),
    constraint ck_messages_incoming
        check (
            direction <> 'incoming'
            or (
                sender_contact_point_id is not null
                and status = 'received'
            )
        ),
    constraint ck_messages_outgoing
        check (
            direction <> 'outgoing'
            or status in ('queued', 'sent', 'delivered', 'read', 'failed')
        ),
    constraint ck_messages_timestamps
        check (
            status_updated_at is null
            or status_updated_at >= created_at
        )
);

create unique index uq_messages_external_identity
    on public.messages (channel_connection_id, external_message_id)
    where external_message_id is not null;

create unique index uq_messages_client_idempotency
    on public.messages (workspace_id, client_idempotency_key)
    where client_idempotency_key is not null;

create index idx_messages_conversation_cursor
    on public.messages (
        workspace_id,
        conversation_id,
        occurred_at desc,
        id desc
    );

create index idx_messages_pending_delivery
    on public.messages (workspace_id, status, status_updated_at)
    where status in ('queued', 'sent', 'failed');

create table public.attachments (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    message_id uuid not null,
    storage_bucket text not null,
    storage_key text not null,
    original_file_name text not null,
    mime_type text not null,
    size_bytes bigint not null,
    sha256 text,
    status text not null,
    created_at timestamptz default now() not null,
    available_at timestamptz,
    archived_at timestamptz,

    constraint pk_attachments primary key (id),
    constraint uq_attachments_workspace_id_id
        unique (workspace_id, id),
    constraint uq_attachments_storage_object
        unique (storage_bucket, storage_key),
    constraint fk_attachments_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_attachments_message
        foreign key (workspace_id, message_id)
        references public.messages (workspace_id, id)
        on delete restrict,
    constraint ck_attachments_bucket_nonempty
        check (btrim(storage_bucket) <> ''),
    constraint ck_attachments_storage_key_nonempty
        check (btrim(storage_key) <> ''),
    constraint ck_attachments_file_name_safe
        check (
            btrim(original_file_name) <> ''
            and strpos(original_file_name, '/') = 0
            and strpos(original_file_name, chr(92)) = 0
        ),
    constraint ck_attachments_mime_type_nonempty
        check (btrim(mime_type) <> ''),
    constraint ck_attachments_size_positive
        check (size_bytes > 0),
    constraint ck_attachments_sha256
        check (sha256 is null or sha256 ~ '^[0-9A-Fa-f]{64}$'),
    constraint ck_attachments_status
        check (
            status in ('pending', 'available', 'unavailable', 'archived')
        ),
    constraint ck_attachments_lifecycle
        check (
            (status = 'pending' and available_at is null and archived_at is null)
            or (status = 'available' and available_at is not null and archived_at is null)
            or (status = 'unavailable' and archived_at is null)
            or (status = 'archived' and archived_at is not null)
        ),
    constraint ck_attachments_timestamps
        check (
            (available_at is null or available_at >= created_at)
            and (archived_at is null or archived_at >= created_at)
        )
);

create index idx_attachments_message
    on public.attachments (workspace_id, message_id, created_at);

create index idx_attachments_pending
    on public.attachments (workspace_id, status)
    where status = 'pending';

create table public.conversation_assignments (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    conversation_id uuid not null,
    member_id uuid not null,
    assigned_by_member_id uuid not null,
    ended_by_member_id uuid,
    assigned_at timestamptz not null,
    ended_at timestamptz,
    end_reason text,

    constraint pk_conversation_assignments primary key (id),
    constraint fk_conversation_assignments_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_conversation_assignments_conversation
        foreign key (workspace_id, conversation_id)
        references public.conversations (workspace_id, id)
        on delete restrict,
    constraint fk_conversation_assignments_member
        foreign key (workspace_id, member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint fk_conversation_assignments_assigned_by
        foreign key (workspace_id, assigned_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint fk_conversation_assignments_ended_by
        foreign key (workspace_id, ended_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_conversation_assignments_end_reason_nonempty
        check (end_reason is null or btrim(end_reason) <> ''),
    constraint ck_conversation_assignments_end_state
        check (
            (ended_at is null and ended_by_member_id is null and end_reason is null)
            or (ended_at is not null and ended_at >= assigned_at)
        )
);

create unique index uq_conversation_assignments_active_member
    on public.conversation_assignments (conversation_id, member_id)
    where ended_at is null;

create index idx_conversation_assignments_conversation
    on public.conversation_assignments (
        workspace_id,
        conversation_id,
        ended_at
    );

create index idx_conversation_assignments_member
    on public.conversation_assignments (
        workspace_id,
        member_id,
        ended_at,
        assigned_at desc
    );
