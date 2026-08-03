-- ImobFlux Sprint 10: pipeline, opportunities, tasks, and internal notes.

create table public.pipeline_stages (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    name text not null,
    position integer not null,
    is_active boolean not null,
    commercial_meaning text,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    deactivated_at timestamptz,

    constraint pk_pipeline_stages primary key (id),
    constraint uq_pipeline_stages_workspace_id_id
        unique (workspace_id, id),
    constraint fk_pipeline_stages_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint ck_pipeline_stages_name_nonempty
        check (btrim(name) <> ''),
    constraint ck_pipeline_stages_position_positive
        check (position > 0),
    constraint ck_pipeline_stages_meaning_nonempty
        check (
            commercial_meaning is null
            or btrim(commercial_meaning) <> ''
        ),
    constraint ck_pipeline_stages_activation
        check (
            (is_active and deactivated_at is null)
            or (not is_active and deactivated_at is not null)
        ),
    constraint ck_pipeline_stages_timestamps
        check (
            updated_at >= created_at
            and (
                deactivated_at is null
                or deactivated_at >= created_at
            )
        )
);

create unique index uq_pipeline_stages_active_position
    on public.pipeline_stages (workspace_id, position)
    where is_active;

create unique index uq_pipeline_stages_active_name
    on public.pipeline_stages (workspace_id, lower(btrim(name)))
    where is_active;

create index idx_pipeline_stages_order
    on public.pipeline_stages (workspace_id, is_active, position);

create table public.opportunities (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    contact_id uuid not null,
    current_stage_id uuid not null,
    responsible_member_id uuid,
    title text not null,
    description text,
    status text not null,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    closed_at timestamptz,
    archived_at timestamptz,

    constraint pk_opportunities primary key (id),
    constraint uq_opportunities_workspace_id_id
        unique (workspace_id, id),
    constraint fk_opportunities_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_opportunities_contact
        foreign key (workspace_id, contact_id)
        references public.contacts (workspace_id, id)
        on delete restrict,
    constraint fk_opportunities_current_stage
        foreign key (workspace_id, current_stage_id)
        references public.pipeline_stages (workspace_id, id)
        on delete restrict,
    constraint fk_opportunities_responsible_member
        foreign key (workspace_id, responsible_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_opportunities_title_nonempty
        check (btrim(title) <> ''),
    constraint ck_opportunities_description_nonempty
        check (description is null or btrim(description) <> ''),
    constraint ck_opportunities_status
        check (status in ('open', 'won', 'lost')),
    constraint ck_opportunities_closure
        check (
            (status = 'open' and closed_at is null)
            or (status in ('won', 'lost') and closed_at is not null)
        ),
    constraint ck_opportunities_timestamps
        check (
            updated_at >= created_at
            and (closed_at is null or closed_at >= created_at)
            and (archived_at is null or archived_at >= created_at)
        )
);

create index idx_opportunities_kanban
    on public.opportunities (
        workspace_id,
        current_stage_id,
        status,
        updated_at desc,
        id
    );

create index idx_opportunities_responsible
    on public.opportunities (workspace_id, responsible_member_id, status)
    where responsible_member_id is not null;

create index idx_opportunities_contact
    on public.opportunities (workspace_id, contact_id, created_at desc);

create index idx_opportunities_archived
    on public.opportunities (workspace_id, archived_at);

create table public.opportunity_conversations (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    opportunity_id uuid not null,
    conversation_id uuid not null,
    linked_by_member_id uuid not null,
    unlinked_by_member_id uuid,
    linked_at timestamptz not null,
    unlinked_at timestamptz,

    constraint pk_opportunity_conversations primary key (id),
    constraint fk_opportunity_conversations_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_opportunity_conversations_opportunity
        foreign key (workspace_id, opportunity_id)
        references public.opportunities (workspace_id, id)
        on delete restrict,
    constraint fk_opportunity_conversations_conversation
        foreign key (workspace_id, conversation_id)
        references public.conversations (workspace_id, id)
        on delete restrict,
    constraint fk_opportunity_conversations_linked_by
        foreign key (workspace_id, linked_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint fk_opportunity_conversations_unlinked_by
        foreign key (workspace_id, unlinked_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_opportunity_conversations_unlink_state
        check (
            (unlinked_at is null and unlinked_by_member_id is null)
            or (unlinked_at is not null and unlinked_at >= linked_at)
        )
);

create unique index uq_opportunity_conversations_active_link
    on public.opportunity_conversations (opportunity_id, conversation_id)
    where unlinked_at is null;

create index idx_opportunity_conversations_opportunity
    on public.opportunity_conversations (
        workspace_id,
        opportunity_id,
        unlinked_at
    );

create index idx_opportunity_conversations_conversation
    on public.opportunity_conversations (
        workspace_id,
        conversation_id,
        unlinked_at
    );

create table public.pipeline_history (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    opportunity_id uuid not null,
    previous_stage_id uuid,
    new_stage_id uuid not null,
    changed_by_member_id uuid not null,
    reason text,
    changed_at timestamptz not null,

    constraint pk_pipeline_history primary key (id),
    constraint fk_pipeline_history_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_pipeline_history_opportunity
        foreign key (workspace_id, opportunity_id)
        references public.opportunities (workspace_id, id)
        on delete restrict,
    constraint fk_pipeline_history_previous_stage
        foreign key (workspace_id, previous_stage_id)
        references public.pipeline_stages (workspace_id, id)
        on delete restrict,
    constraint fk_pipeline_history_new_stage
        foreign key (workspace_id, new_stage_id)
        references public.pipeline_stages (workspace_id, id)
        on delete restrict,
    constraint fk_pipeline_history_changed_by
        foreign key (workspace_id, changed_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_pipeline_history_stage_change
        check (
            previous_stage_id is null
            or previous_stage_id <> new_stage_id
        ),
    constraint ck_pipeline_history_reason_nonempty
        check (reason is null or btrim(reason) <> '')
);

create index idx_pipeline_history_opportunity_cursor
    on public.pipeline_history (
        workspace_id,
        opportunity_id,
        changed_at desc,
        id desc
    );

create index idx_pipeline_history_new_stage
    on public.pipeline_history (
        workspace_id,
        new_stage_id,
        changed_at desc
    );

create table public.work_tasks (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    task_type text not null,
    title text not null,
    description text,
    status text not null,
    priority text not null,
    due_at timestamptz not null,
    reminder_at timestamptz,
    responsible_member_id uuid,
    contact_id uuid,
    opportunity_id uuid,
    conversation_id uuid,
    created_by_member_id uuid not null,
    completed_by_member_id uuid,
    cancelled_by_member_id uuid,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    completed_at timestamptz,
    cancelled_at timestamptz,
    archived_at timestamptz,

    constraint pk_work_tasks primary key (id),
    constraint uq_work_tasks_workspace_id_id
        unique (workspace_id, id),
    constraint fk_work_tasks_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_work_tasks_responsible_member
        foreign key (workspace_id, responsible_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint fk_work_tasks_contact
        foreign key (workspace_id, contact_id)
        references public.contacts (workspace_id, id)
        on delete restrict,
    constraint fk_work_tasks_opportunity
        foreign key (workspace_id, opportunity_id)
        references public.opportunities (workspace_id, id)
        on delete restrict,
    constraint fk_work_tasks_conversation
        foreign key (workspace_id, conversation_id)
        references public.conversations (workspace_id, id)
        on delete restrict,
    constraint fk_work_tasks_created_by
        foreign key (workspace_id, created_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint fk_work_tasks_completed_by
        foreign key (workspace_id, completed_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint fk_work_tasks_cancelled_by
        foreign key (workspace_id, cancelled_by_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint ck_work_tasks_type
        check (task_type in ('task', 'follow_up')),
    constraint ck_work_tasks_title_nonempty
        check (btrim(title) <> ''),
    constraint ck_work_tasks_description_nonempty
        check (description is null or btrim(description) <> ''),
    constraint ck_work_tasks_status
        check (status in ('pending', 'completed', 'cancelled')),
    constraint ck_work_tasks_priority
        check (priority in ('low', 'normal', 'high', 'urgent')),
    constraint ck_work_tasks_context
        check (num_nonnulls(contact_id, opportunity_id, conversation_id) >= 1),
    constraint ck_work_tasks_lifecycle
        check (
            (
                status = 'pending'
                and completed_at is null
                and completed_by_member_id is null
                and cancelled_at is null
                and cancelled_by_member_id is null
            )
            or (
                status = 'completed'
                and completed_at is not null
                and completed_by_member_id is not null
                and cancelled_at is null
                and cancelled_by_member_id is null
            )
            or (
                status = 'cancelled'
                and cancelled_at is not null
                and cancelled_by_member_id is not null
                and completed_at is null
                and completed_by_member_id is null
            )
        ),
    constraint ck_work_tasks_reminder
        check (reminder_at is null or reminder_at <= due_at),
    constraint ck_work_tasks_timestamps
        check (
            updated_at >= created_at
            and (completed_at is null or completed_at >= created_at)
            and (cancelled_at is null or cancelled_at >= created_at)
            and (archived_at is null or archived_at >= created_at)
        )
);

create index idx_work_tasks_priorities
    on public.work_tasks (workspace_id, status, due_at, priority, id);

create index idx_work_tasks_responsible
    on public.work_tasks (
        workspace_id,
        responsible_member_id,
        status,
        due_at
    )
    where responsible_member_id is not null;

create index idx_work_tasks_contact
    on public.work_tasks (workspace_id, contact_id, status, due_at)
    where contact_id is not null;

create index idx_work_tasks_opportunity
    on public.work_tasks (workspace_id, opportunity_id, status, due_at)
    where opportunity_id is not null;

create index idx_work_tasks_conversation
    on public.work_tasks (workspace_id, conversation_id, status, due_at)
    where conversation_id is not null;

create index idx_work_tasks_archived
    on public.work_tasks (workspace_id, archived_at);

create table public.internal_notes (
    id uuid default gen_random_uuid() not null,
    workspace_id uuid not null,
    author_member_id uuid not null,
    content text not null,
    contact_id uuid,
    opportunity_id uuid,
    conversation_id uuid,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,
    archived_at timestamptz,

    constraint pk_internal_notes primary key (id),
    constraint fk_internal_notes_workspace
        foreign key (workspace_id)
        references public.workspaces (id)
        on delete restrict,
    constraint fk_internal_notes_author
        foreign key (workspace_id, author_member_id)
        references public.workspace_members (workspace_id, id)
        on delete restrict,
    constraint fk_internal_notes_contact
        foreign key (workspace_id, contact_id)
        references public.contacts (workspace_id, id)
        on delete restrict,
    constraint fk_internal_notes_opportunity
        foreign key (workspace_id, opportunity_id)
        references public.opportunities (workspace_id, id)
        on delete restrict,
    constraint fk_internal_notes_conversation
        foreign key (workspace_id, conversation_id)
        references public.conversations (workspace_id, id)
        on delete restrict,
    constraint ck_internal_notes_content_nonempty
        check (btrim(content) <> ''),
    constraint ck_internal_notes_context
        check (num_nonnulls(contact_id, opportunity_id, conversation_id) = 1),
    constraint ck_internal_notes_timestamps
        check (
            updated_at >= created_at
            and (archived_at is null or archived_at >= created_at)
        )
);

create index idx_internal_notes_contact
    on public.internal_notes (
        workspace_id,
        contact_id,
        archived_at,
        created_at desc
    )
    where contact_id is not null;

create index idx_internal_notes_opportunity
    on public.internal_notes (
        workspace_id,
        opportunity_id,
        archived_at,
        created_at desc
    )
    where opportunity_id is not null;

create index idx_internal_notes_conversation
    on public.internal_notes (
        workspace_id,
        conversation_id,
        archived_at,
        created_at desc
    )
    where conversation_id is not null;
