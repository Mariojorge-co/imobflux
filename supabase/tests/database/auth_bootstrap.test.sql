begin;
set search_path = public, extensions, pg_catalog;

create extension if not exists pgtap with schema extensions;

select plan(55);

select ok(
    exists (
        select 1
        from pg_catalog.pg_constraint as constraint_record
        join pg_catalog.pg_class as source_table
          on source_table.oid = constraint_record.conrelid
        join pg_catalog.pg_namespace as source_schema
          on source_schema.oid = source_table.relnamespace
        join pg_catalog.pg_class as target_table
          on target_table.oid = constraint_record.confrelid
        join pg_catalog.pg_namespace as target_schema
          on target_schema.oid = target_table.relnamespace
        where constraint_record.conname = 'fk_app_users_auth_user'
          and source_schema.nspname = 'public'
          and source_table.relname = 'app_users'
          and target_schema.nspname = 'auth'
          and target_table.relname = 'users'
          and constraint_record.contype = 'f'
    ),
    'app_users.auth_user_id references auth.users.id'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_constraint as constraint_record
        where constraint_record.conname = 'fk_app_users_auth_user'
          and constraint_record.confdeltype = 'n'
          and constraint_record.convalidated
    ),
    'Auth user foreign key is validated and uses ON DELETE SET NULL'
);

select has_function(
    'public',
    'bootstrap_initial_workspace',
    array['uuid', 'text', 'text', 'text'],
    'initial bootstrap function exists with the approved signature'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as procedure_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where namespace_record.nspname = 'public'
          and procedure_record.proname = 'bootstrap_initial_workspace'
          and not procedure_record.prosecdef
    ),
    'initial bootstrap function uses SECURITY INVOKER'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as procedure_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where namespace_record.nspname = 'public'
          and procedure_record.proname = 'bootstrap_initial_workspace'
          and procedure_record.proconfig = array['search_path=""']::text[]
    ),
    'initial bootstrap function has an empty search_path'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc as procedure_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where namespace_record.nspname = 'public'
          and procedure_record.proname = 'bootstrap_initial_workspace'
          and pg_catalog.pg_get_functiondef(procedure_record.oid)
                ilike '%pg_catalog.pg_advisory_xact_lock%'
    ),
    'initial bootstrap serializes concurrent attempts with an advisory lock'
);

select ok(
    not pg_catalog.has_function_privilege(
        'public',
        'public.bootstrap_initial_workspace(uuid,text,text,text)',
        'execute'
    ),
    'PUBLIC cannot execute the initial bootstrap function'
);

select ok(
    not pg_catalog.has_function_privilege(
        'anon',
        'public.bootstrap_initial_workspace(uuid,text,text,text)',
        'execute'
    ),
    'anon cannot execute the initial bootstrap function'
);

select ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.bootstrap_initial_workspace(uuid,text,text,text)',
        'execute'
    ),
    'authenticated cannot execute the initial bootstrap function'
);

select ok(
    pg_catalog.has_function_privilege(
        'service_role',
        'public.bootstrap_initial_workspace(uuid,text,text,text)',
        'execute'
    ),
    'service_role can execute the initial bootstrap function'
);

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
    ('audit_events'),
    ('opportunity_financials');

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
    array['app_users', 'opportunity_financials', 'pipeline_stages', 'workspace_members', 'workspaces']::text[],
    'service_role has SELECT on authorized tables'
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
        'opportunity_financials',
        'pipeline_stages',
        'workspace_members',
        'workspaces'
    ]::text[],
    'service_role has INSERT on authorized tables'
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
    ),
    1::bigint,
    'service_role has UPDATE on opportunity_financials'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'delete'
        )
    ),
    0::bigint,
    'service_role has no DELETE on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'truncate'
        )
    ),
    1::bigint,
    'service_role has TRUNCATE on opportunity_financials'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'trigger'
        )
    ),
    1::bigint,
    'service_role has TRIGGER on opportunity_financials'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'service_role',
            pg_catalog.format('public.%I', table_name),
            'references'
        )
    ),
    1::bigint,
    'service_role has REFERENCES on opportunity_financials'
);

select is(
    (
        select count(*)
        from domain_tables
        where table_name not in (
            'app_users',
            'audit_events',
            'opportunity_financials',
            'pipeline_stages',
            'workspace_members',
            'workspaces'
        )
          and (
              pg_catalog.has_table_privilege(
                  'service_role',
                  pg_catalog.format('public.%I', table_name),
                  'select'
              )
              or pg_catalog.has_table_privilege(
                  'service_role',
                  pg_catalog.format('public.%I', table_name),
                  'insert'
              )
              or pg_catalog.has_table_privilege(
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
                  'trigger'
              )
              or pg_catalog.has_table_privilege(
                  'service_role',
                  pg_catalog.format('public.%I', table_name),
                  'references'
              )
          )
    ),
    0::bigint,
    'service_role has no privilege on the other 13 domain tables'
);

select is(
    (
        select count(*)
        from information_schema.table_privileges as privilege_record
        where privilege_record.table_schema = 'public'
          and privilege_record.table_name in (
              select table_name from domain_tables
          )
          and privilege_record.grantee = 'PUBLIC'
    ),
    0::bigint,
    'PUBLIC has no privilege on any domain table'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_proc as procedure_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = procedure_record.pronamespace
        where namespace_record.nspname = 'public'
          and procedure_record.prosecdef
    ),
    19::bigint,
    'only the approved contact, WhatsApp and Kanban RPCs use SECURITY DEFINER in the public schema'
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
    ),
    0::bigint,
    'anon has no SELECT on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'insert'
        )
    ),
    0::bigint,
    'anon has no INSERT on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'update'
        )
    ),
    0::bigint,
    'anon has no UPDATE on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'delete'
        )
    ),
    0::bigint,
    'anon has no DELETE on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'truncate'
        )
    ),
    0::bigint,
    'anon has no TRUNCATE on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'references'
        )
    ),
    0::bigint,
    'anon has no REFERENCES on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'anon',
            pg_catalog.format('public.%I', table_name),
            'trigger'
        )
    ),
    0::bigint,
    'anon has no TRIGGER on any domain table'
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
    19::bigint,
    'authenticated has SELECT on all 19 RLS-protected domain tables'
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
    ),
    1::bigint,
    'authenticated has INSERT on opportunity_financials'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'update'
        )
    ),
    1::bigint,
    'authenticated has UPDATE on opportunity_financials'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'delete'
        )
    ),
    0::bigint,
    'authenticated has no DELETE on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'truncate'
        )
    ),
    0::bigint,
    'authenticated has no TRUNCATE on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'references'
        )
    ),
    0::bigint,
    'authenticated has no REFERENCES on any domain table'
);

select is(
    (
        select count(*)
        from domain_tables
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_name),
            'trigger'
        )
    ),
    0::bigint,
    'authenticated has no TRIGGER on any domain table'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_class as class_record
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = class_record.relnamespace
        where namespace_record.nspname = 'public'
          and class_record.relname in (select table_name from domain_tables)
          and class_record.relrowsecurity
    ),
    19::bigint,
    'RLS is enabled on all 19 domain tables'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_policy as policy_record
        join pg_catalog.pg_class as class_record
          on class_record.oid = policy_record.polrelid
        join pg_catalog.pg_namespace as namespace_record
          on namespace_record.oid = class_record.relnamespace
        where namespace_record.nspname = 'public'
          and class_record.relname in (select table_name from domain_tables)
    ),
    19::bigint,
    'each domain table has one read-only OWNER policy'
);

insert into auth.users (id, email)
values (
    '12000000-0000-4000-8000-000000000001',
    'bootstrap-database-test@example.invalid'
);

select lives_ok(
    $test$
        select *
        from public.bootstrap_initial_workspace(
            '12000000-0000-4000-8000-000000000001',
            'Initial Owner',
            'Initial Workspace',
            'America/Sao_Paulo'
        )
    $test$,
    'initial bootstrap creates the public domain atomically'
);

select is(
    (
        select count(*)
        from public.app_users
        where auth_user_id = '12000000-0000-4000-8000-000000000001'
          and display_name = 'Initial Owner'
          and status = 'active'
    ),
    1::bigint,
    'initial bootstrap creates one linked active app user'
);

select is(
    (
        select count(*)
        from public.workspaces
        where name = 'Initial Workspace'
          and status = 'active'
          and timezone = 'America/Sao_Paulo'
    ),
    1::bigint,
    'initial bootstrap creates one active workspace'
);

select is(
    (
        select count(*)
        from public.workspace_members as member
        join public.app_users as app_user
          on app_user.id = member.user_id
        where app_user.auth_user_id = '12000000-0000-4000-8000-000000000001'
          and member.role = 'owner'
          and member.status = 'active'
          and member.invited_by_member_id is null
          and member.activated_at is not null
    ),
    1::bigint,
    'initial bootstrap creates the first active OWNER without invitation data'
);

select is(
    (
        select count(*)
        from public.audit_events
        where action = 'bootstrap.completed'
          and actor_type = 'system'
          and result = 'success'
    ),
    1::bigint,
    'successful bootstrap records one system audit event'
);

select is(
    (
        select count(*)
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
    ),
    6::bigint,
    'initial bootstrap creates exactly 6 default pipeline stages'
);

select is(
    (
        select name
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
          and position = 1
    ),
    'Em atendimento',
    'default stage 1 is Em atendimento'
);

select is(
    (
        select name
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
          and position = 2
    ),
    'Simulação / Análise',
    'default stage 2 is Simulação / Análise'
);

select is(
    (
        select name
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
          and position = 3
    ),
    'Documentação',
    'default stage 3 is Documentação'
);

select is(
    (
        select name
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
          and position = 4
    ),
    'Aprovado / Escolhendo imóvel',
    'default stage 4 is Aprovado / Escolhendo imóvel'
);

select is(
    (
        select name
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
          and position = 5
    ),
    'Negociação',
    'default stage 5 is Negociação'
);

select is(
    (
        select name
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
          and position = 6
    ),
    'Contrato',
    'default stage 6 is Contrato'
);

select is(
    (
        select count(*)
        from public.pipeline_stages
        where workspace_id = (select id from public.workspaces where name = 'Initial Workspace')
          and is_active = true
    ),
    6::bigint,
    'all 6 default stages are active'
);

select is(
    public.provision_default_pipeline_stages((select id from public.workspaces where name = 'Initial Workspace')),
    0,
    're-running provision_default_pipeline_stages is idempotent and returns 0 without duplicating stages'
);

insert into auth.users (id, email)
values (
    '12000000-0000-4000-8000-000000000002',
    'second-bootstrap-test@example.invalid'
);

select throws_ok(
    $test$
        select *
        from public.bootstrap_initial_workspace(
            '12000000-0000-4000-8000-000000000002',
            'Second Owner',
            'Second Workspace',
            'America/Sao_Paulo'
        )
    $test$,
    '55000',
    'Initial bootstrap is closed',
    'any existing workspace closes the global bootstrap'
);

select lives_ok(
    $test$
        delete from auth.users
        where id = '12000000-0000-4000-8000-000000000001'
    $test$,
    'removing an Auth user does not delete the durable public identity'
);

select is(
    (
        select count(*)
        from public.app_users
        where display_name = 'Initial Owner'
          and auth_user_id is null
    ),
    1::bigint,
    'removing an Auth user clears only app_users.auth_user_id'
);

select is(
    (
        select count(*)
        from public.workspace_members as member
        join public.app_users as app_user
          on app_user.id = member.user_id
        where app_user.display_name = 'Initial Owner'
          and member.role = 'owner'
          and member.status = 'active'
    ),
    1::bigint,
    'Auth user removal preserves the OWNER membership and historical identity'
);

select is(
    (select count(*) from public.workspaces),
    1::bigint,
    'Auth user removal preserves the workspace'
);

select * from finish();

rollback;
