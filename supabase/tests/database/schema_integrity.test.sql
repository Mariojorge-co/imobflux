begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(75);

select has_table('public', 'app_users', 'app_users exists');
select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'workspace_members', 'workspace_members exists');
select has_table('public', 'contacts', 'contacts exists');
select has_table('public', 'contact_points', 'contact_points exists');
select has_table('public', 'channel_connections', 'channel_connections exists');
select has_table('public', 'conversations', 'conversations exists');
select has_table(
    'public',
    'conversation_participants',
    'conversation_participants exists'
);
select has_table('public', 'messages', 'messages exists');
select has_table('public', 'attachments', 'attachments exists');
select has_table(
    'public',
    'conversation_assignments',
    'conversation_assignments exists'
);
select has_table('public', 'pipeline_stages', 'pipeline_stages exists');
select has_table('public', 'opportunities', 'opportunities exists');
select has_table(
    'public',
    'opportunity_conversations',
    'opportunity_conversations exists'
);
select has_table('public', 'pipeline_history', 'pipeline_history exists');
select has_table('public', 'work_tasks', 'work_tasks exists');
select has_table('public', 'internal_notes', 'internal_notes exists');
select has_table('public', 'audit_events', 'audit_events exists');

select is(
    (
        select count(*)
        from pg_catalog.pg_constraint as constraint_record
        join pg_catalog.pg_namespace as namespace_record
            on namespace_record.oid = constraint_record.connamespace
        where namespace_record.nspname = 'public'
          and constraint_record.contype = 'p'
          and constraint_record.conrelid in (
              select class_record.oid
              from pg_catalog.pg_class as class_record
              join pg_catalog.pg_namespace as class_namespace
                on class_namespace.oid = class_record.relnamespace
              where class_namespace.nspname = 'public'
                and class_record.relkind = 'r'
                and class_record.relname in (
                    'app_users',
                    'workspaces',
                    'workspace_members',
                    'contacts',
                    'contact_points',
                    'channel_connections',
                    'conversations',
                    'conversation_participants',
                    'messages',
                    'attachments',
                    'conversation_assignments',
                    'pipeline_stages',
                    'opportunities',
                    'opportunity_conversations',
                    'pipeline_history',
                    'work_tasks',
                    'internal_notes',
                    'audit_events',
                    'opportunity_financials'
                )
          )
    ),
    19::bigint,
    'all 19 domain tables have primary keys'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_class as class_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = class_record.relnamespace
        where namespace_record.nspname = 'public'
          and class_record.relkind = 'r'
          and class_record.relrowsecurity
          and class_record.relname in (
              'app_users',
              'workspaces',
              'workspace_members',
              'contacts',
              'contact_points',
              'channel_connections',
              'conversations',
              'conversation_participants',
              'messages',
              'attachments',
              'conversation_assignments',
              'pipeline_stages',
              'opportunities',
              'opportunity_conversations',
              'pipeline_history',
              'work_tasks',
              'internal_notes',
              'audit_events',
              'opportunity_financials'
          )
    ),
    19::bigint,
    'RLS is enabled on all 19 domain tables'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_constraint as constraint_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = constraint_record.connamespace
        where namespace_record.nspname = 'public'
          and constraint_record.contype = 'f'
          and constraint_record.confdeltype = 'c'
    ),
    0::bigint,
    'no public foreign key uses ON DELETE CASCADE'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        join pg_catalog.pg_proc as procedure_record
          on procedure_record.oid = trigger_record.tgfoid
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where not trigger_record.tgisinternal
          and namespace_record.nspname = 'public'
          and procedure_record.proname = 'set_updated_at'
    ),
    12::bigint,
    'set_updated_at remains attached to the 12 standard mutable tables'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        join pg_catalog.pg_proc as procedure_record
          on procedure_record.oid = trigger_record.tgfoid
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where not trigger_record.tgisinternal
          and namespace_record.nspname = 'public'
          and procedure_record.proname = 'set_opportunity_updated_at'
          and trigger_record.tgrelid = 'public.opportunities'::regclass
    ),
    1::bigint,
    'opportunities uses the sort_order-aware updated_at trigger'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as procedure_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where namespace_record.nspname = 'public'
          and procedure_record.proname = 'set_updated_at'
          and not procedure_record.prosecdef
          and pg_catalog.pg_get_functiondef(procedure_record.oid)
                ilike '%pg_catalog.statement_timestamp()%'
    ),
    'set_updated_at uses statement_timestamp without SECURITY DEFINER'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        join pg_catalog.pg_proc as procedure_record
          on procedure_record.oid = trigger_record.tgfoid
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where not trigger_record.tgisinternal
          and namespace_record.nspname = 'public'
          and procedure_record.proname = 'prevent_append_only_mutation'
          and pg_catalog.pg_get_triggerdef(trigger_record.oid)
                ilike '%BEFORE TRUNCATE%'
    ),
    2::bigint,
    'append-only protection has TRUNCATE triggers on both tables'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_index as index_record
        join pg_catalog.pg_class as index_class
          on index_class.oid = index_record.indexrelid
        join pg_catalog.pg_class as table_class
          on table_class.oid = index_record.indrelid
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = table_class.relnamespace
        where namespace_record.nspname = 'public'
          and table_class.relname = 'app_users'
          and index_class.relname = 'uq_app_users_auth_user'
          and index_record.indisunique
          and index_record.indpred is not null
          and pg_catalog.pg_get_expr(
                index_record.indpred,
                index_record.indrelid
              ) ilike '%auth_user_id IS NOT NULL%'
    ),
    'auth_user_id has an explicit partial unique index for non-null values'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_index as index_record
        join pg_catalog.pg_class as index_class
          on index_class.oid = index_record.indexrelid
        join pg_catalog.pg_class as table_class
          on table_class.oid = index_record.indrelid
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = table_class.relnamespace
        where namespace_record.nspname = 'public'
          and table_class.relname = 'messages'
          and index_class.relname = 'idx_messages_sender_contact_point'
          and index_record.indpred is not null
          and pg_catalog.pg_get_expr(
                index_record.indpred,
                index_record.indrelid
              ) ilike '%sender_contact_point_id IS NOT NULL%'
    ),
    'messages has an explicit partial index for sender_contact_point_id'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_index as index_record
        join pg_catalog.pg_class as index_class
          on index_class.oid = index_record.indexrelid
        join pg_catalog.pg_class as table_class
          on table_class.oid = index_record.indrelid
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = table_class.relnamespace
        where namespace_record.nspname = 'public'
          and table_class.relname = 'messages'
          and index_class.relname = 'idx_messages_internal_author'
          and index_record.indpred is not null
          and pg_catalog.pg_get_expr(
                index_record.indpred,
                index_record.indrelid
              ) ilike '%internal_author_member_id IS NOT NULL%'
    ),
    'messages has an explicit partial index for internal_author_member_id'
);


select is(
    (
        with tenant_tables as (
            select distinct table_class.oid
            from pg_catalog.pg_class as table_class
            join pg_catalog.pg_namespace as namespace_record
              on namespace_record.oid = table_class.relnamespace
            join pg_catalog.pg_attribute as attribute_record
              on attribute_record.attrelid = table_class.oid
             and attribute_record.attname = 'workspace_id'
             and attribute_record.attnum > 0
             and not attribute_record.attisdropped
            where namespace_record.nspname = 'public'
              and table_class.relkind = 'r'
        )
        select count(*)
        from pg_catalog.pg_constraint as constraint_record
        where constraint_record.contype = 'f'
          and constraint_record.conrelid in (select oid from tenant_tables)
          and constraint_record.confrelid in (select oid from tenant_tables)
          and not exists (
              select 1
              from unnest(constraint_record.conkey) with ordinality
                as child_key(attnum, key_position)
              join unnest(constraint_record.confkey) with ordinality
                as parent_key(attnum, key_position)
                using (key_position)
              join pg_catalog.pg_attribute as child_attribute
                on child_attribute.attrelid = constraint_record.conrelid
               and child_attribute.attnum = child_key.attnum
              join pg_catalog.pg_attribute as parent_attribute
                on parent_attribute.attrelid = constraint_record.confrelid
               and parent_attribute.attnum = parent_key.attnum
              where child_attribute.attname = 'workspace_id'
                and parent_attribute.attname = 'workspace_id'
          )
    ),
    0::bigint,
    'all foreign keys between tenant tables include workspace_id on both sides'
);

insert into public.app_users (
    id,
    display_name,
    status
)
values
    ('10000000-0000-4000-8000-000000000001', 'Owner One', 'active'),
    ('10000000-0000-4000-8000-000000000002', 'Owner Two', 'active'),
    ('10000000-0000-4000-8000-000000000003', 'Attendant One', 'active'),
    ('10000000-0000-4000-8000-000000000004', 'Owner Candidate', 'active');

insert into public.workspaces (
    id,
    name,
    status,
    timezone
)
values
    (
        '20000000-0000-4000-8000-000000000001',
        'Workspace One',
        'active',
        'America/Sao_Paulo'
    ),
    (
        '20000000-0000-4000-8000-000000000002',
        'Workspace Two',
        'active',
        'America/Sao_Paulo'
    );

select lives_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            user_id,
            role,
            status,
            invited_by_member_id,
            invited_at,
            activated_at
        )
        values
            (
                '30000000-0000-4000-8000-000000000001',
                '20000000-0000-4000-8000-000000000001',
                '10000000-0000-4000-8000-000000000001',
                'owner',
                'active',
                null,
                null,
                now()
            ),
            (
                '30000000-0000-4000-8000-000000000002',
                '20000000-0000-4000-8000-000000000002',
                '10000000-0000-4000-8000-000000000002',
                'owner',
                'active',
                null,
                null,
                now()
            )
    $test$,
    'initial active OWNER without invitation author is allowed'
);

insert into public.workspace_members (
    id,
    workspace_id,
    user_id,
    invited_email_normalized,
    role,
    status,
    invited_by_member_id,
    invited_at,
    activated_at
)
values (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'attendant@example.test',
    'attendant',
    'active',
    '30000000-0000-4000-8000-000000000001',
    now(),
    now()
);

insert into public.contacts (
    id,
    workspace_id,
    display_name,
    classification,
    operational_status
)
values
    (
        '40000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'Contact One',
        'person',
        'active'
    ),
    (
        '40000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        'Contact Two',
        'person',
        'active'
    );

insert into public.contact_points (
    id,
    workspace_id,
    contact_id,
    point_type,
    normalized_value,
    operational_status
)
values
    (
        '50000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        'phone',
        '+5511999990001',
        'active'
    ),
    (
        '50000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        '40000000-0000-4000-8000-000000000002',
        'phone',
        '+5511999990001',
        'active'
    );

insert into public.channel_connections (
    id,
    workspace_id,
    provider,
    external_account_id,
    external_phone_normalized,
    status,
    activated_at
)
values
    (
        '60000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'whatsapp',
        'wa-account-one',
        '+5511888880001',
        'active',
        now()
    ),
    (
        '60000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        'whatsapp',
        'wa-account-two',
        '+5511888880002',
        'active',
        now()
    );

insert into public.conversations (
    id,
    workspace_id,
    channel_connection_id,
    external_thread_id,
    conversation_type,
    operational_status,
    visibility,
    started_at
)
values
    (
        '70000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000001',
        'thread-one',
        'individual',
        'active',
        'commercial',
        now()
    ),
    (
        '70000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        '60000000-0000-4000-8000-000000000002',
        'thread-two',
        'individual',
        'active',
        'commercial',
        now()
    );

insert into public.pipeline_stages (
    id,
    workspace_id,
    name,
    position,
    is_active
)
values
    (
        '80000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'Initial',
        1,
        true
    ),
    (
        '80000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        'Initial',
        1,
        true
    );

insert into public.opportunities (
    id,
    workspace_id,
    contact_id,
    current_stage_id,
    title,
    status
)
values
    (
        '90000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '80000000-0000-4000-8000-000000000001',
        'Opportunity One',
        'open'
    ),
    (
        '90000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '80000000-0000-4000-8000-000000000001',
        'Opportunity With History',
        'open'
    );

insert into public.messages (
    id,
    workspace_id,
    channel_connection_id,
    conversation_id,
    external_message_id,
    direction,
    origin,
    sender_contact_point_id,
    text_content,
    status,
    occurred_at,
    external_created_at,
    received_at
)
values (
    'a0000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'external-message-one',
    'incoming',
    'whatsapp',
    '50000000-0000-4000-8000-000000000001',
    'Synthetic incoming message',
    'received',
    now(),
    now(),
    now()
);

insert into public.messages (
    id,
    workspace_id,
    channel_connection_id,
    conversation_id,
    client_idempotency_key,
    direction,
    origin,
    internal_author_member_id,
    text_content,
    status,
    occurred_at
)
values (
    'a0000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'outgoing',
    'crm',
    '30000000-0000-4000-8000-000000000003',
    'Synthetic outgoing message',
    'queued',
    now()
);

insert into public.conversation_assignments (
    id,
    workspace_id,
    conversation_id,
    member_id,
    assigned_by_member_id,
    assigned_at
)
values (
    'b0000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
    now()
);

insert into public.opportunity_conversations (
    id,
    workspace_id,
    opportunity_id,
    conversation_id,
    linked_by_member_id,
    linked_at
)
values (
    'c0000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    now()
);

insert into public.pipeline_history (
    id,
    workspace_id,
    opportunity_id,
    previous_stage_id,
    new_stage_id,
    changed_by_member_id,
    changed_at
)
values (
    'd0000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000002',
    null,
    '80000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    now()
);

insert into public.audit_events (
    id,
    workspace_id,
    actor_type,
    action,
    target_type,
    result,
    occurred_at
)
values (
    'e0000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'system',
    'test.action',
    'test_target',
    'success',
    now()
);

insert into auth.users (id)
values ('11000000-0000-4000-8000-000000000001');

update public.app_users
set auth_user_id = '11000000-0000-4000-8000-000000000001'
where id = '10000000-0000-4000-8000-000000000001';

select throws_ok(
    $test$
        insert into public.app_users (
            id,
            auth_user_id,
            display_name,
            status
        )
        values (
            '10000000-0000-4000-8000-000000000010',
            '11000000-0000-4000-8000-000000000001',
            'Duplicate Auth User',
            'active'
        )
    $test$,
    '23505',
    null,
    'partial auth_user_id index rejects duplicate non-null values'
);

select lives_ok(
    $test$
        update public.workspace_members
        set
            status = 'suspended',
            suspended_at = pg_catalog.statement_timestamp()
        where id = '30000000-0000-4000-8000-000000000002'
    $test$,
    'initial OWNER without invitation author remains valid when suspended'
);

select lives_ok(
    $test$
        update public.workspace_members
        set
            status = 'removed',
            removed_at = pg_catalog.statement_timestamp()
        where id = '30000000-0000-4000-8000-000000000002'
    $test$,
    'initial OWNER without invitation author remains valid when removed'
);

select throws_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            invited_email_normalized,
            role,
            status,
            invited_at
        )
        values (
            '30000000-0000-4000-8000-000000000013',
            '20000000-0000-4000-8000-000000000001',
            'missing-author-invited@example.test',
            'attendant',
            'invited',
            now()
        )
    $test$,
    '23514',
    null,
    'invited ATTENDANT without invitation author is rejected'
);

select throws_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            user_id,
            role,
            status,
            activated_at
        )
        values (
            '30000000-0000-4000-8000-000000000014',
            '20000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000004',
            'attendant',
            'active',
            now()
        )
    $test$,
    '23514',
    null,
    'active ATTENDANT without invitation author is rejected'
);

select lives_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            invited_email_normalized,
            role,
            status,
            invited_by_member_id,
            invited_at
        )
        values (
            '30000000-0000-4000-8000-000000000015',
            '20000000-0000-4000-8000-000000000001',
            'same-workspace-author@example.test',
            'attendant',
            'invited',
            '30000000-0000-4000-8000-000000000001',
            now()
        )
    $test$,
    'invitation authored by a member of the same workspace is allowed'
);

select throws_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            invited_email_normalized,
            role,
            status,
            invited_by_member_id,
            invited_at
        )
        values (
            '30000000-0000-4000-8000-000000000016',
            '20000000-0000-4000-8000-000000000001',
            'cross-workspace-author@example.test',
            'attendant',
            'invited',
            '30000000-0000-4000-8000-000000000002',
            now()
        )
    $test$,
    '23503',
    null,
    'invitation author from another workspace is rejected'
);

select throws_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            invited_email_normalized,
            role,
            status,
            invited_by_member_id,
            invited_at
        )
        values (
            '30000000-0000-4000-8000-000000000017',
            '20000000-0000-4000-8000-000000000001',
            'self-authored@example.test',
            'attendant',
            'invited',
            '30000000-0000-4000-8000-000000000017',
            now()
        )
    $test$,
    '23514',
    null,
    'membership cannot author its own invitation'
);

select lives_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            user_id,
            invited_email_normalized,
            role,
            status,
            invited_by_member_id,
            invited_at,
            removed_at
        )
        values (
            '30000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            null,
            'cancelled@example.test',
            'attendant',
            'removed',
            '30000000-0000-4000-8000-000000000001',
            now(),
            now()
        )
    $test$,
    'cancelled invitation may be removed without user_id before activation'
);

select throws_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            user_id,
            invited_email_normalized,
            role,
            status,
            invited_by_member_id,
            invited_at,
            activated_at,
            removed_at
        )
        values (
            '30000000-0000-4000-8000-000000000012',
            '20000000-0000-4000-8000-000000000001',
            null,
            'activated-without-user@example.test',
            'attendant',
            'removed',
            '30000000-0000-4000-8000-000000000001',
            now(),
            now(),
            now()
        )
    $test$,
    '23514',
    null,
    'activated membership cannot be removed without preserving user_id'
);

select throws_ok(
    $test$
        insert into public.contact_points (
            id,
            workspace_id,
            contact_id,
            point_type,
            normalized_value,
            operational_status
        )
        values (
            '50000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000002',
            'phone',
            '+5511999990010',
            'active'
        )
    $test$,
    '23503',
    null,
    'cross-workspace foreign key is rejected'
);

select throws_ok(
    $test$
        insert into public.workspace_members (
            id,
            workspace_id,
            user_id,
            role,
            status,
            invited_by_member_id,
            activated_at
        )
        values (
            '30000000-0000-4000-8000-000000000011',
            '20000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000004',
            'owner',
            'active',
            '30000000-0000-4000-8000-000000000001',
            now()
        )
    $test$,
    '23505',
    null,
    'second non-removed OWNER is rejected'
);

select throws_ok(
    $test$
        insert into public.channel_connections (
            id,
            workspace_id,
            provider,
            external_account_id,
            external_phone_normalized,
            status,
            activated_at
        )
        values (
            '60000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            'whatsapp',
            'wa-account-three',
            '+5511888880010',
            'active',
            now()
        )
    $test$,
    '23505',
    null,
    'second active WhatsApp connection in a workspace is rejected'
);

select throws_ok(
    $test$
        insert into public.contact_points (
            id,
            workspace_id,
            contact_id,
            point_type,
            normalized_value,
            operational_status
        )
        values (
            '50000000-0000-4000-8000-000000000011',
            '20000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            'phone',
            '+5511999990001',
            'active'
        )
    $test$,
    '23505',
    null,
    'duplicate normalized contact point in a workspace is rejected'
);

select throws_ok(
    $test$
        insert into public.conversations (
            id,
            workspace_id,
            channel_connection_id,
            external_thread_id,
            conversation_type,
            operational_status,
            visibility,
            started_at
        )
        values (
            '70000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            'thread-one',
            'individual',
            'active',
            'commercial',
            now()
        )
    $test$,
    '23505',
    null,
    'conversation thread is unique within its channel connection'
);

select throws_ok(
    $test$
        insert into public.pipeline_stages (
            id,
            workspace_id,
            name,
            position,
            is_active
        )
        values (
            '80000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            'Different Name',
            1,
            true
        )
    $test$,
    '23505',
    null,
    'active pipeline stage position is unique within a workspace'
);

select throws_ok(
    $test$
        insert into public.pipeline_stages (
            id,
            workspace_id,
            name,
            position,
            is_active
        )
        values (
            '80000000-0000-4000-8000-000000000011',
            '20000000-0000-4000-8000-000000000001',
            '  INITIAL  ',
            2,
            true
        )
    $test$,
    '23505',
    null,
    'active pipeline stage normalized name is unique within a workspace'
);

select throws_ok(
    $test$
        insert into public.attachments (
            id,
            workspace_id,
            message_id,
            storage_bucket,
            storage_key,
            original_file_name,
            mime_type,
            size_bytes,
            status,
            available_at
        )
        values (
            'a2000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            'a0000000-0000-4000-8000-000000000001',
            'test-bucket',
            'pending-with-available-at',
            'pending.txt',
            'text/plain',
            1,
            'pending',
            now()
        )
    $test$,
    '23514',
    null,
    'pending attachment cannot have available_at'
);

select throws_ok(
    $test$
        insert into public.attachments (
            id,
            workspace_id,
            message_id,
            storage_bucket,
            storage_key,
            original_file_name,
            mime_type,
            size_bytes,
            status
        )
        values (
            'a2000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000001',
            'a0000000-0000-4000-8000-000000000001',
            'test-bucket',
            'available-without-available-at',
            'available.txt',
            'text/plain',
            1,
            'available'
        )
    $test$,
    '23514',
    null,
    'available attachment requires available_at'
);

select throws_ok(
    $test$
        insert into public.attachments (
            id,
            workspace_id,
            message_id,
            storage_bucket,
            storage_key,
            original_file_name,
            mime_type,
            size_bytes,
            status
        )
        values (
            'a2000000-0000-4000-8000-000000000003',
            '20000000-0000-4000-8000-000000000001',
            'a0000000-0000-4000-8000-000000000001',
            'test-bucket',
            'archived-without-archived-at',
            'archived.txt',
            'text/plain',
            1,
            'archived'
        )
    $test$,
    '23514',
    null,
    'archived attachment requires archived_at'
);

select throws_ok(
    $test$
        insert into public.audit_events (
            id,
            workspace_id,
            actor_type,
            action,
            target_type,
            result,
            occurred_at
        )
        values (
            'e0000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            'member',
            'test.invalid-member-actor',
            'test_target',
            'failed',
            now()
        )
    $test$,
    '23514',
    null,
    'member audit actor requires actor_member_id'
);

select throws_ok(
    $test$
        insert into public.audit_events (
            id,
            workspace_id,
            actor_type,
            actor_member_id,
            action,
            target_type,
            result,
            occurred_at
        )
        values (
            'e0000000-0000-4000-8000-000000000011',
            '20000000-0000-4000-8000-000000000001',
            'system',
            '30000000-0000-4000-8000-000000000001',
            'test.invalid-system-actor',
            'test_target',
            'failed',
            now()
        )
    $test$,
    '23514',
    null,
    'system audit actor cannot have actor_member_id'
);

select throws_ok(
    $test$
        insert into public.conversation_participants (
            id,
            workspace_id,
            conversation_id,
            first_seen_at
        )
        values (
            '71000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            now()
        )
    $test$,
    '23514',
    null,
    'participant without an identity is rejected'
);

select throws_ok(
    $test$
        insert into public.conversation_participants (
            id,
            workspace_id,
            conversation_id,
            contact_point_id,
            workspace_member_id,
            first_seen_at
        )
        values (
            '71000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000003',
            now()
        )
    $test$,
    '23514',
    null,
    'participant with two identities is rejected'
);

select throws_ok(
    $test$
        insert into public.messages (
            id,
            workspace_id,
            channel_connection_id,
            conversation_id,
            direction,
            origin,
            text_content,
            status,
            occurred_at
        )
        values (
            'a0000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'outgoing',
            'crm',
            'Invalid CRM message',
            'queued',
            now()
        )
    $test$,
    '23514',
    null,
    'CRM message without author and local key is rejected'
);

select throws_ok(
    $test$
        insert into public.messages (
            id,
            workspace_id,
            channel_connection_id,
            conversation_id,
            external_message_id,
            direction,
            origin,
            internal_author_member_id,
            text_content,
            status,
            occurred_at,
            external_created_at,
            received_at
        )
        values (
            'a0000000-0000-4000-8000-000000000011',
            '20000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'external-message-invalid-author',
            'outgoing',
            'whatsapp',
            '30000000-0000-4000-8000-000000000003',
            'Invalid WhatsApp authorship',
            'sent',
            now(),
            now(),
            now()
        )
    $test$,
    '23514',
    null,
    'WhatsApp-origin message with internal author is rejected'
);

select throws_ok(
    $test$
        insert into public.messages (
            id,
            workspace_id,
            channel_connection_id,
            conversation_id,
            external_message_id,
            direction,
            origin,
            sender_contact_point_id,
            status,
            occurred_at,
            external_created_at,
            received_at
        )
        values (
            'a0000000-0000-4000-8000-000000000012',
            '20000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'external-message-one',
            'incoming',
            'whatsapp',
            '50000000-0000-4000-8000-000000000001',
            'received',
            now(),
            now(),
            now()
        )
    $test$,
    '23505',
    null,
    'duplicate external message identity is rejected'
);

select throws_ok(
    $test$
        insert into public.messages (
            id,
            workspace_id,
            channel_connection_id,
            conversation_id,
            client_idempotency_key,
            direction,
            origin,
            internal_author_member_id,
            status,
            occurred_at
        )
        values (
            'a0000000-0000-4000-8000-000000000013',
            '20000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            'a1000000-0000-4000-8000-000000000001',
            'outgoing',
            'crm',
            '30000000-0000-4000-8000-000000000003',
            'queued',
            now()
        )
    $test$,
    '23505',
    null,
    'duplicate CRM idempotency key is rejected'
);

select throws_ok(
    $test$
        insert into public.work_tasks (
            id,
            workspace_id,
            task_type,
            title,
            status,
            priority,
            due_at,
            created_by_member_id
        )
        values (
            'f0000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            'task',
            'Task without context',
            'pending',
            'normal',
            now() + interval '1 day',
            '30000000-0000-4000-8000-000000000001'
        )
    $test$,
    '23514',
    null,
    'task without context is rejected'
);

select throws_ok(
    $test$
        insert into public.internal_notes (
            id,
            workspace_id,
            author_member_id,
            content
        )
        values (
            'f1000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            'Note without context'
        )
    $test$,
    '23514',
    null,
    'internal note without context is rejected'
);

select throws_ok(
    $test$
        insert into public.internal_notes (
            id,
            workspace_id,
            author_member_id,
            content,
            contact_id,
            opportunity_id
        )
        values (
            'f1000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            'Note with two contexts',
            '40000000-0000-4000-8000-000000000001',
            '90000000-0000-4000-8000-000000000001'
        )
    $test$,
    '23514',
    null,
    'internal note with more than one context is rejected'
);

select throws_ok(
    $test$
        insert into public.opportunities (
            id,
            workspace_id,
            contact_id,
            current_stage_id,
            title,
            status
        )
        values (
            '90000000-0000-4000-8000-000000000010',
            '20000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000001',
            '80000000-0000-4000-8000-000000000001',
            'Closed without timestamp',
            'won'
        )
    $test$,
    '23514',
    null,
    'closed opportunity without closed_at is rejected'
);

select throws_ok(
    $test$
        insert into public.conversation_assignments (
            id,
            workspace_id,
            conversation_id,
            member_id,
            assigned_by_member_id,
            assigned_at
        )
        values (
            'b0000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000003',
            '30000000-0000-4000-8000-000000000001',
            now()
        )
    $test$,
    '23505',
    null,
    'duplicate active conversation assignment is rejected'
);

select throws_ok(
    $test$
        insert into public.opportunity_conversations (
            id,
            workspace_id,
            opportunity_id,
            conversation_id,
            linked_by_member_id,
            linked_at
        )
        values (
            'c0000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000001',
            '90000000-0000-4000-8000-000000000001',
            '70000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            now()
        )
    $test$,
    '23505',
    null,
    'duplicate active opportunity-conversation link is rejected'
);

select throws_ok(
    $test$
        delete from public.opportunities
        where id = '90000000-0000-4000-8000-000000000002'
    $test$,
    '23503',
    null,
    'opportunity with pipeline history cannot be physically deleted'
);

select ok(
    exists (
        select 1
        from public.pipeline_history
        where id = 'd0000000-0000-4000-8000-000000000001'
    ),
    'pipeline history remains after rejected parent deletion'
);

select throws_ok(
    $test$
        update public.pipeline_history
        set reason = 'Mutation must fail'
        where id = 'd0000000-0000-4000-8000-000000000001'
    $test$,
    '55000',
    null,
    'pipeline history rejects updates'
);

select throws_ok(
    $test$
        delete from public.pipeline_history
        where id = 'd0000000-0000-4000-8000-000000000001'
    $test$,
    '55000',
    null,
    'pipeline history rejects deletes'
);

select throws_ok(
    $test$
        truncate table public.pipeline_history
    $test$,
    '55000',
    null,
    'pipeline history rejects truncation'
);

select throws_ok(
    $test$
        update public.audit_events
        set result = 'failed'
        where id = 'e0000000-0000-4000-8000-000000000001'
    $test$,
    '55000',
    null,
    'audit events reject updates'
);

select throws_ok(
    $test$
        delete from public.audit_events
        where id = 'e0000000-0000-4000-8000-000000000001'
    $test$,
    '55000',
    null,
    'audit events reject deletes'
);

select throws_ok(
    $test$
        truncate table public.audit_events
    $test$,
    '55000',
    null,
    'audit events reject truncation'
);

create temporary table updated_at_snapshot (
    value timestamptz not null
);

insert into updated_at_snapshot (value)
select updated_at
from public.contacts
where id = '40000000-0000-4000-8000-000000000001';

do $test$
begin
    perform pg_catalog.pg_sleep(0.01);
end;
$test$;

select lives_ok(
    $test$
        update public.contacts
        set
            display_name = 'Contact One Updated',
            updated_at = '2099-01-01 00:00:00+00'::timestamptz
        where id = '40000000-0000-4000-8000-000000000001'
    $test$,
    'mutable table update succeeds through updated_at trigger'
);

select cmp_ok(
    (
        select updated_at
        from public.contacts
        where id = '40000000-0000-4000-8000-000000000001'
    ),
    '>',
    (select value from updated_at_snapshot),
    'updated_at advances on a later statement in the same transaction'
);

select isnt(
    (
        select updated_at
        from public.contacts
        where id = '40000000-0000-4000-8000-000000000001'
    ),
    '2099-01-01 00:00:00+00'::timestamptz,
    'updated_at trigger overrides the value supplied by the client'
);

select * from finish();

rollback;
