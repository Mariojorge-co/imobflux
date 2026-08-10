begin;

create extension if not exists pgtap with schema extensions;

select plan(60);

create temporary table domain_tables (
    table_name text primary key
) on commit drop;

insert into domain_tables (table_name)
values
    ('app_users'),
    ('workspaces'),
    ('workspace_members'),
    ('contacts'),
    ('contact_points'),
    ('channel_connections'),
    ('conversations'),
    ('conversation_participants'),
    ('messages'),
    ('attachments'),
    ('conversation_assignments'),
    ('pipeline_stages'),
    ('opportunities'),
    ('opportunity_conversations'),
    ('pipeline_history'),
    ('work_tasks'),
    ('internal_notes'),
    ('audit_events');

select is(
    (
        select count(*)
        from pg_catalog.pg_class as table_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = table_record.relnamespace
        where schema_record.nspname = 'public'
          and table_record.relname in (select table_name from domain_tables)
          and table_record.relrowsecurity
    ),
    18::bigint,
    'RLS is enabled on all 18 domain tables'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_policy as policy_record
        join pg_catalog.pg_class as table_record
          on table_record.oid = policy_record.polrelid
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = table_record.relnamespace
        where schema_record.nspname = 'public'
          and table_record.relname in (select table_name from domain_tables)
    ),
    18::bigint,
    'there is exactly one policy for each domain table'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_policy as policy_record
        join pg_catalog.pg_class as table_record
          on table_record.oid = policy_record.polrelid
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = table_record.relnamespace
        where schema_record.nspname = 'public'
          and table_record.relname in (select table_name from domain_tables)
          and policy_record.polcmd = 'r'
    ),
    18::bigint,
    'all domain policies apply only to SELECT'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_policy as policy_record
        join pg_catalog.pg_class as table_record
          on table_record.oid = policy_record.polrelid
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = table_record.relnamespace
        where schema_record.nspname = 'public'
          and table_record.relname in (select table_name from domain_tables)
          and policy_record.polcmd in ('a', 'w', 'd')
    ),
    0::bigint,
    'no INSERT, UPDATE, or DELETE policy exists'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_policy as policy_record
        join pg_catalog.pg_class as table_record
          on table_record.oid = policy_record.polrelid
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = table_record.relnamespace
        where schema_record.nspname = 'public'
          and table_record.relname in (select table_name from domain_tables)
          and pg_catalog.cardinality(policy_record.polroles) = 1
          and (
              select role_record.oid
              from pg_catalog.pg_roles as role_record
              where role_record.rolname = 'authenticated'
          ) = any(policy_record.polroles)
    ),
    18::bigint,
    'all domain policies target authenticated exclusively'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_policy as policy_record
        join pg_catalog.pg_class as table_record
          on table_record.oid = policy_record.polrelid
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = table_record.relnamespace
        where schema_record.nspname = 'public'
          and table_record.relname in (select table_name from domain_tables)
          and pg_catalog.pg_get_expr(
                policy_record.polqual,
                policy_record.polrelid
              ) ilike '%private.active_owner_context()%'
    ),
    18::bigint,
    'all policies derive authorization from the stable context subquery'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'select'
        )
    ),
    18::bigint,
    'authenticated has SELECT on all 18 domain tables'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'insert'
        )
        or pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'update'
        )
        or pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'delete'
        )
        or pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'truncate'
        )
        or pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'references'
        )
        or pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'trigger'
        )
    ),
    0::bigint,
    'authenticated has no domain write or structural table privilege'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'select'
        )
        or pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'insert'
        )
        or pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'update'
        )
        or pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'delete'
        )
        or pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'truncate'
        )
        or pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'references'
        )
        or pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'trigger'
        )
    ),
    0::bigint,
    'anon has no privilege on any domain table'
);

select is(
    (
        select count(*)
        from information_schema.table_privileges as privilege_record
        where privilege_record.table_schema = 'public'
          and privilege_record.table_name in (select table_name from domain_tables)
          and privilege_record.grantee = 'PUBLIC'
    ),
    0::bigint,
    'PUBLIC has no privilege on any domain table'
);

select is(
    (
        select pg_catalog.array_agg(table_name order by table_name)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'select'
        )
    ),
    array['app_users', 'pipeline_stages', 'workspace_members', 'workspaces']::text[],
    'service_role retains exactly the four approved SELECT privileges'
);

select is(
    (
        select pg_catalog.array_agg(table_name order by table_name)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'insert'
        )
    ),
    array[
        'app_users',
        'audit_events',
        'pipeline_stages',
        'workspace_members',
        'workspaces'
    ]::text[],
    'service_role retains exactly the five approved INSERT privileges'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'update'
        )
        or pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'delete'
        )
        or pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'truncate'
        )
        or pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'references'
        )
        or pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'trigger'
        )
    ),
    0::bigint,
    'service_role receives no additional domain privilege'
);

select has_schema('private', 'private authorization schema exists');

select ok(
    not pg_catalog.has_schema_privilege('public', 'private', 'usage'),
    'PUBLIC has no USAGE on private'
);

select ok(
    not pg_catalog.has_schema_privilege('public', 'private', 'create'),
    'PUBLIC has no CREATE on private'
);

select ok(
    not pg_catalog.has_schema_privilege('anon', 'private', 'usage'),
    'anon has no USAGE on private'
);

select ok(
    not pg_catalog.has_schema_privilege('anon', 'private', 'create'),
    'anon has no CREATE on private'
);

select ok(
    pg_catalog.has_schema_privilege('authenticated', 'private', 'usage'),
    'authenticated has USAGE on private'
);

select ok(
    not pg_catalog.has_schema_privilege('authenticated', 'private', 'create'),
    'authenticated cannot create objects in private'
);

select ok(
    not pg_catalog.has_schema_privilege('service_role', 'private', 'usage'),
    'service_role has no USAGE on private'
);

select has_function(
    'private',
    'active_owner_context',
    array[]::text[],
    'active_owner_context exists without parameters'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
          and function_record.pronargs = 0
          and function_record.proretset
    ),
    'active_owner_context has no parameters and returns a set'
);

select is(
    (
        select pg_catalog.pg_get_function_result(function_record.oid)
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
    ),
    'TABLE(app_user_id uuid, member_id uuid, workspace_id uuid)'::text,
    'active_owner_context returns only the approved identifiers'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
          and function_record.provolatile = 's'
    ),
    'active_owner_context is STABLE'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        join pg_catalog.pg_language as language_record
          on language_record.oid = function_record.prolang
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
          and language_record.lanname = 'sql'
    ),
    'active_owner_context is a SQL function'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
          and function_record.prosecdef
    ),
    'active_owner_context uses SECURITY DEFINER'
);

select is(
    (
        select owner_record.rolname
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        join pg_catalog.pg_roles as owner_record
          on owner_record.oid = function_record.proowner
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
    ),
    'postgres'::name,
    'active_owner_context is owned by postgres'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
          and function_record.proconfig = array['search_path=""']::text[]
    ),
    'active_owner_context has an empty search_path'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
          and pg_catalog.pg_get_functiondef(function_record.oid)
                ilike '%public.app_users%'
          and pg_catalog.pg_get_functiondef(function_record.oid)
                ilike '%public.workspace_members%'
          and pg_catalog.pg_get_functiondef(function_record.oid)
                ilike '%public.workspaces%'
          and pg_catalog.pg_get_functiondef(function_record.oid)
                ilike '%auth.uid()%'
    ),
    'active_owner_context uses only fully qualified authorization objects'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'private'
          and function_record.proname = 'active_owner_context'
          and pg_catalog.pg_get_functiondef(function_record.oid)
                !~* '\mexecute\M'
          and pg_catalog.pg_get_functiondef(function_record.oid)
                !~* '\mformat\s*\('
    ),
    'active_owner_context contains no dynamic SQL'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname in ('public', 'private')
          and function_record.prosecdef
    ),
    20::bigint,
    'only the owner context and approved domain operations use SECURITY DEFINER'
);

select ok(
    not pg_catalog.has_function_privilege(
        'public',
        'private.active_owner_context()',
        'execute'
    ),
    'PUBLIC cannot execute active_owner_context'
);

select ok(
    not pg_catalog.has_function_privilege(
        'anon',
        'private.active_owner_context()',
        'execute'
    ),
    'anon cannot execute active_owner_context'
);

select ok(
    pg_catalog.has_function_privilege(
        'authenticated',
        'private.active_owner_context()',
        'execute'
    ),
    'authenticated can execute active_owner_context'
);

select ok(
    not pg_catalog.has_function_privilege(
        'service_role',
        'private.active_owner_context()',
        'execute'
    ),
    'service_role cannot execute active_owner_context'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        join pg_catalog.pg_proc as function_record
          on function_record.oid = trigger_record.tgfoid
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where not trigger_record.tgisinternal
          and schema_record.nspname = 'public'
          and function_record.proname = 'prevent_append_only_mutation'
          and pg_catalog.pg_get_triggerdef(trigger_record.oid)
                ilike '%BEFORE DELETE OR UPDATE%'
    ),
    2::bigint,
    'both append-only tables retain UPDATE and DELETE guards'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_trigger as trigger_record
        join pg_catalog.pg_proc as function_record
          on function_record.oid = trigger_record.tgfoid
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where not trigger_record.tgisinternal
          and schema_record.nspname = 'public'
          and function_record.proname = 'prevent_append_only_mutation'
          and pg_catalog.pg_get_triggerdef(trigger_record.oid)
                ilike '%BEFORE TRUNCATE%'
    ),
    2::bigint,
    'both append-only tables retain TRUNCATE guards'
);

insert into auth.users (id, email)
values
    ('01000000-0000-4000-8000-000000000001', 'owner-one@example.invalid'),
    ('02000000-0000-4000-8000-000000000002', 'owner-two@example.invalid'),
    ('03000000-0000-4000-8000-000000000003', 'auth-only@example.invalid'),
    ('04000000-0000-4000-8000-000000000004', 'inactive-app@example.invalid'),
    ('05000000-0000-4000-8000-000000000005', 'no-membership@example.invalid'),
    ('06000000-0000-4000-8000-000000000006', 'invited@example.invalid'),
    ('07000000-0000-4000-8000-000000000007', 'suspended@example.invalid'),
    ('08000000-0000-4000-8000-000000000008', 'removed@example.invalid'),
    ('09000000-0000-4000-8000-000000000009', 'attendant@example.invalid'),
    ('0a000000-0000-4000-8000-00000000000a', 'inactive-workspace@example.invalid');

insert into public.app_users (
    id,
    auth_user_id,
    display_name,
    status,
    deactivated_at
)
values
    (
        '11000000-0000-4000-8000-000000000001',
        '01000000-0000-4000-8000-000000000001',
        'Owner One',
        'active',
        null
    ),
    (
        '12000000-0000-4000-8000-000000000002',
        '02000000-0000-4000-8000-000000000002',
        'Owner Two',
        'active',
        null
    ),
    (
        '14000000-0000-4000-8000-000000000004',
        '04000000-0000-4000-8000-000000000004',
        'Inactive App User',
        'inactive',
        now()
    ),
    (
        '15000000-0000-4000-8000-000000000005',
        '05000000-0000-4000-8000-000000000005',
        'No Membership',
        'active',
        null
    ),
    (
        '16000000-0000-4000-8000-000000000006',
        '06000000-0000-4000-8000-000000000006',
        'Invited Member',
        'active',
        null
    ),
    (
        '17000000-0000-4000-8000-000000000007',
        '07000000-0000-4000-8000-000000000007',
        'Suspended Member',
        'active',
        null
    ),
    (
        '18000000-0000-4000-8000-000000000008',
        '08000000-0000-4000-8000-000000000008',
        'Removed Member',
        'active',
        null
    ),
    (
        '19000000-0000-4000-8000-000000000009',
        '09000000-0000-4000-8000-000000000009',
        'Active Attendant',
        'active',
        null
    ),
    (
        '1a000000-0000-4000-8000-00000000000a',
        '0a000000-0000-4000-8000-00000000000a',
        'Owner In Inactive Workspace',
        'active',
        null
    );

insert into public.workspaces (id, name, status, timezone)
values
    (
        '21000000-0000-4000-8000-000000000001',
        'Workspace One',
        'active',
        'America/Maceio'
    ),
    (
        '22000000-0000-4000-8000-000000000002',
        'Workspace Two',
        'active',
        'America/Maceio'
    ),
    (
        '2a000000-0000-4000-8000-00000000000a',
        'Suspended Workspace',
        'suspended',
        'America/Maceio'
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
    activated_at,
    suspended_at,
    removed_at
)
values
    (
        '31000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '11000000-0000-4000-8000-000000000001',
        null,
        'owner',
        'active',
        null,
        null,
        now(),
        null,
        null
    ),
    (
        '32000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '12000000-0000-4000-8000-000000000002',
        null,
        'owner',
        'active',
        null,
        null,
        now(),
        null,
        null
    ),
    (
        '36000000-0000-4000-8000-000000000006',
        '21000000-0000-4000-8000-000000000001',
        '16000000-0000-4000-8000-000000000006',
        'invited@example.invalid',
        'attendant',
        'invited',
        '31000000-0000-4000-8000-000000000001',
        now(),
        null,
        null,
        null
    ),
    (
        '37000000-0000-4000-8000-000000000007',
        '21000000-0000-4000-8000-000000000001',
        '17000000-0000-4000-8000-000000000007',
        'suspended@example.invalid',
        'attendant',
        'suspended',
        '31000000-0000-4000-8000-000000000001',
        now(),
        now(),
        now(),
        null
    ),
    (
        '38000000-0000-4000-8000-000000000008',
        '21000000-0000-4000-8000-000000000001',
        '18000000-0000-4000-8000-000000000008',
        'removed@example.invalid',
        'attendant',
        'removed',
        '31000000-0000-4000-8000-000000000001',
        now(),
        now(),
        null,
        now()
    ),
    (
        '39000000-0000-4000-8000-000000000009',
        '21000000-0000-4000-8000-000000000001',
        '19000000-0000-4000-8000-000000000009',
        'attendant@example.invalid',
        'attendant',
        'active',
        '31000000-0000-4000-8000-000000000001',
        now(),
        now(),
        null,
        null
    ),
    (
        '3a000000-0000-4000-8000-00000000000a',
        '2a000000-0000-4000-8000-00000000000a',
        '1a000000-0000-4000-8000-00000000000a',
        null,
        'owner',
        'active',
        null,
        null,
        now(),
        null,
        null
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
        '41000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        'Contact One',
        'person',
        'active'
    ),
    (
        '42000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
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
        '51000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '41000000-0000-4000-8000-000000000001',
        'phone',
        '+5582999990001',
        'active'
    ),
    (
        '52000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '42000000-0000-4000-8000-000000000002',
        'phone',
        '+5582999990002',
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
        '61000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        'whatsapp',
        'rls-account-one',
        '+5582888880001',
        'active',
        now()
    ),
    (
        '62000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        'whatsapp',
        'rls-account-two',
        '+5582888880002',
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
        '71000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000001',
        'rls-thread-one',
        'individual',
        'active',
        'owner_only',
        now()
    ),
    (
        '72000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '62000000-0000-4000-8000-000000000002',
        'rls-thread-two',
        'individual',
        'active',
        'commercial',
        now()
    );

insert into public.conversation_participants (
    id,
    workspace_id,
    conversation_id,
    contact_point_id,
    first_seen_at
)
values
    (
        '73000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001',
        '51000000-0000-4000-8000-000000000001',
        now()
    ),
    (
        '74000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000002',
        '52000000-0000-4000-8000-000000000002',
        now()
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
values
    (
        '81000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001',
        'rls-message-one',
        'incoming',
        'whatsapp',
        '51000000-0000-4000-8000-000000000001',
        'Synthetic message one',
        'received',
        now(),
        now(),
        now()
    ),
    (
        '82000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '62000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000002',
        'rls-message-two',
        'incoming',
        'whatsapp',
        '52000000-0000-4000-8000-000000000002',
        'Synthetic message two',
        'received',
        now(),
        now(),
        now()
    );

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
values
    (
        '83000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '81000000-0000-4000-8000-000000000001',
        'private-attachments',
        'rls/one.txt',
        'one.txt',
        'text/plain',
        10,
        'available',
        now()
    ),
    (
        '84000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '82000000-0000-4000-8000-000000000002',
        'private-attachments',
        'rls/two.txt',
        'two.txt',
        'text/plain',
        10,
        'available',
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
values
    (
        '85000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        now()
    ),
    (
        '86000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002',
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
        '91000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        'Initial One',
        1,
        true
    ),
    (
        '92000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        'Initial Two',
        1,
        true
    );

insert into public.opportunities (
    id,
    workspace_id,
    contact_id,
    current_stage_id,
    responsible_member_id,
    title,
    status
)
values
    (
        '93000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '41000000-0000-4000-8000-000000000001',
        '91000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        'Opportunity One',
        'open'
    ),
    (
        '94000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '42000000-0000-4000-8000-000000000002',
        '92000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002',
        'Opportunity Two',
        'open'
    );

insert into public.opportunity_conversations (
    id,
    workspace_id,
    opportunity_id,
    conversation_id,
    linked_by_member_id,
    linked_at
)
values
    (
        '95000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '93000000-0000-4000-8000-000000000001',
        '71000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        now()
    ),
    (
        '96000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '94000000-0000-4000-8000-000000000002',
        '72000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002',
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
values
    (
        '97000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '93000000-0000-4000-8000-000000000001',
        null,
        '91000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        now()
    ),
    (
        '98000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '94000000-0000-4000-8000-000000000002',
        null,
        '92000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002',
        now()
    );

insert into public.work_tasks (
    id,
    workspace_id,
    task_type,
    title,
    status,
    priority,
    due_at,
    responsible_member_id,
    contact_id,
    created_by_member_id
)
values
    (
        'a1000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        'task',
        'Task One',
        'pending',
        'normal',
        now() + interval '1 day',
        '31000000-0000-4000-8000-000000000001',
        '41000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001'
    ),
    (
        'a2000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        'task',
        'Task Two',
        'pending',
        'normal',
        now() + interval '1 day',
        '32000000-0000-4000-8000-000000000002',
        '42000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002'
    );

insert into public.internal_notes (
    id,
    workspace_id,
    author_member_id,
    content,
    contact_id
)
values
    (
        'a3000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        'Synthetic note one',
        '41000000-0000-4000-8000-000000000001'
    ),
    (
        'a4000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        '32000000-0000-4000-8000-000000000002',
        'Synthetic note two',
        '42000000-0000-4000-8000-000000000002'
    );

insert into public.audit_events (
    id,
    workspace_id,
    actor_type,
    action,
    target_type,
    target_id,
    result,
    occurred_at
)
values
    (
        'a5000000-0000-4000-8000-000000000001',
        '21000000-0000-4000-8000-000000000001',
        'system',
        'rls.synthetic.one',
        'workspace',
        '21000000-0000-4000-8000-000000000001',
        'success',
        now()
    ),
    (
        'a6000000-0000-4000-8000-000000000002',
        '22000000-0000-4000-8000-000000000002',
        'system',
        'rls.synthetic.two',
        'workspace',
        '22000000-0000-4000-8000-000000000002',
        'success',
        now()
    );

set local role authenticated;

select pg_catalog.set_config('request.jwt.claims', '{}'::text, true);

select is(
    (select count(*) from private.active_owner_context()),
    0::bigint,
    'absence of a session produces an empty authorization context'
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'absence of a session cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"03000000-0000-4000-8000-000000000003","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'Auth user without app_user cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"04000000-0000-4000-8000-000000000004","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.app_users),
    0::bigint,
    'inactive app_user cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"05000000-0000-4000-8000-000000000005","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'app_user without membership cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"06000000-0000-4000-8000-000000000006","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'invited membership cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"07000000-0000-4000-8000-000000000007","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'suspended membership cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"08000000-0000-4000-8000-000000000008","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'removed membership cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"09000000-0000-4000-8000-000000000009","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'active ATTENDANT cannot read domain data in the individual version'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"0a000000-0000-4000-8000-00000000000a","role":"authenticated"}',
    true
);

select is(
    (select count(*) from public.workspaces),
    0::bigint,
    'OWNER membership in an inactive workspace cannot read domain data'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"01000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

select is(
    (
        select array[app_user_id, member_id, workspace_id]
        from private.active_owner_context()
    ),
    array[
        '11000000-0000-4000-8000-000000000001'::uuid,
        '31000000-0000-4000-8000-000000000001'::uuid,
        '21000000-0000-4000-8000-000000000001'::uuid
    ],
    'authorization context returns only the authenticated OWNER identifiers'
);

select is(
    array[
        (select count(*)::integer from public.app_users),
        (select count(*)::integer from public.workspaces),
        (select count(*)::integer from public.workspace_members)
    ],
    array[1, 1, 5]::integer[],
    'OWNER reads only its app_user and the membership records of its workspace'
);

select is(
    array[
        (select count(*)::integer from public.contacts),
        (select count(*)::integer from public.contact_points),
        (select count(*)::integer from public.channel_connections),
        (select count(*)::integer from public.conversations),
        (select count(*)::integer from public.conversation_participants),
        (select count(*)::integer from public.messages),
        (select count(*)::integer from public.attachments),
        (select count(*)::integer from public.conversation_assignments),
        (select count(*)::integer from public.pipeline_stages),
        (select count(*)::integer from public.opportunities),
        (select count(*)::integer from public.opportunity_conversations),
        (select count(*)::integer from public.pipeline_history),
        (select count(*)::integer from public.work_tasks),
        (select count(*)::integer from public.internal_notes),
        (select count(*)::integer from public.audit_events)
    ],
    array[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]::integer[],
    'OWNER reads its own rows across all tenant tables, including private history'
);

select is(
    (
        select
            (select count(*) from public.opportunity_conversations
             where workspace_id = '22000000-0000-4000-8000-000000000002')
            + (select count(*) from public.pipeline_history
               where workspace_id = '22000000-0000-4000-8000-000000000002')
            + (select count(*) from public.audit_events
               where workspace_id = '22000000-0000-4000-8000-000000000002')
    ),
    0::bigint,
    'OWNER cannot read associations, histories, or audit from another workspace'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"02000000-0000-4000-8000-000000000002","role":"authenticated"}',
    true
);

select is(
    (
        select count(*)
        from public.contacts
        where id = '42000000-0000-4000-8000-000000000002'
    ),
    1::bigint,
    'a second OWNER sees only the data of its own workspace'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"01000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

select throws_ok(
    $test$
        insert into public.contacts (
            workspace_id,
            display_name,
            classification,
            operational_status
        )
        values (
            '21000000-0000-4000-8000-000000000001',
            'Forbidden Own Insert',
            'person',
            'active'
        )
    $test$,
    '42501',
    null,
    'authenticated cannot insert even in its own workspace'
);

select throws_ok(
    $test$
        insert into public.contacts (
            workspace_id,
            display_name,
            classification,
            operational_status
        )
        values (
            '22000000-0000-4000-8000-000000000002',
            'Forbidden Foreign Insert',
            'person',
            'active'
        )
    $test$,
    '42501',
    null,
    'authenticated cannot insert in another workspace'
);

select throws_ok(
    $test$
        update public.contacts
        set display_name = 'Forbidden Update'
        where id = '41000000-0000-4000-8000-000000000001'
    $test$,
    '42501',
    null,
    'authenticated cannot update rows in its own workspace'
);

select throws_ok(
    $test$
        delete from public.contacts
        where id = '41000000-0000-4000-8000-000000000001'
    $test$,
    '42501',
    null,
    'authenticated cannot delete rows'
);

select throws_ok(
    $test$
        truncate table public.contacts
    $test$,
    '42501',
    null,
    'authenticated cannot truncate domain tables'
);

select throws_ok(
    $test$
        update public.pipeline_history
        set reason = 'Forbidden mutation'
        where id = '97000000-0000-4000-8000-000000000001'
    $test$,
    '42501',
    null,
    'authenticated cannot update pipeline history'
);

select throws_ok(
    $test$
        delete from public.audit_events
        where id = 'a5000000-0000-4000-8000-000000000001'
    $test$,
    '42501',
    null,
    'authenticated cannot delete audit events'
);

reset role;

select * from finish();

rollback;
