begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(43);

create temporary table contact_operation_functions (
    function_name text primary key,
    identity_arguments text not null
);

insert into contact_operation_functions (function_name, identity_arguments)
values
    ('archive_contact', 'p_contact_id uuid'),
    ('create_contact', 'p_display_name text, p_classification text, p_phone_normalized text, p_phone_display_value text'),
    ('restore_contact', 'p_contact_id uuid'),
    ('set_contact_operational_status', 'p_contact_id uuid, p_operational_status text'),
    ('update_contact', 'p_contact_id uuid, p_display_name text, p_classification text, p_phone_normalized text, p_phone_display_value text');

select is(
    (select count(*) from contact_operation_functions),
    5::bigint,
    'exactly five contact write RPCs are approved'
);

select is(
    (
        select count(*)
        from contact_operation_functions as expected
        join pg_catalog.pg_proc as function_record
          on function_record.proname = expected.function_name
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'public'
          and pg_catalog.pg_get_function_identity_arguments(function_record.oid)
                = expected.identity_arguments
          and function_record.prosecdef
          and function_record.provolatile = 'v'
          and function_record.proconfig = array['search_path=""']::text[]
    ),
    5::bigint,
    'all approved contact RPCs are VOLATILE SECURITY DEFINER with an empty search_path'
);

select is(
    (
        select count(*)
        from contact_operation_functions as expected
        join pg_catalog.pg_proc as function_record
          on function_record.proname = expected.function_name
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        join pg_catalog.pg_roles as owner_record
          on owner_record.oid = function_record.proowner
        where schema_record.nspname = 'public'
          and pg_catalog.pg_get_function_identity_arguments(function_record.oid)
                = expected.identity_arguments
          and owner_record.rolname = 'postgres'
    ),
    5::bigint,
    'all approved contact RPCs are owned by postgres'
);

select is(
    (
        select count(*)
        from contact_operation_functions as expected
        join pg_catalog.pg_proc as function_record
          on function_record.proname = expected.function_name
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'public'
          and pg_catalog.pg_get_function_identity_arguments(function_record.oid)
                = expected.identity_arguments
          and pg_catalog.has_function_privilege('authenticated', function_record.oid, 'execute')
    ),
    5::bigint,
    'authenticated can execute all and only approved contact RPC signatures'
);

select is(
    (
        select count(*)
        from contact_operation_functions as expected
        join pg_catalog.pg_proc as function_record
          on function_record.proname = expected.function_name
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'public'
          and pg_catalog.pg_get_function_identity_arguments(function_record.oid)
                = expected.identity_arguments
          and (
              pg_catalog.has_function_privilege('public', function_record.oid, 'execute')
              or pg_catalog.has_function_privilege('anon', function_record.oid, 'execute')
              or pg_catalog.has_function_privilege('service_role', function_record.oid, 'execute')
          )
    ),
    0::bigint,
    'PUBLIC, anon, and service_role cannot execute contact RPCs'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'public'
          and function_record.proname in (select function_name from contact_operation_functions)
          and pg_catalog.lower(function_record.prosrc) not like '%execute%'
          and pg_catalog.lower(function_record.prosrc) not like '%format(%'
    ),
    5::bigint,
    'contact RPCs contain no dynamic SQL'
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
    51::bigint,
    'no unapproved SECURITY DEFINER function exists in application schemas (including reorder_opportunity)'
);

select is(
    (
        select count(*)
        from pg_catalog.pg_proc as function_record
        join pg_catalog.pg_namespace as schema_record
          on schema_record.oid = function_record.pronamespace
        where schema_record.nspname = 'public'
          and function_record.proname in (select function_name from contact_operation_functions)
          and (
              'workspace_id' = any(function_record.proargnames)
              or 'member_id' = any(function_record.proargnames)
              or 'is_protected' = any(function_record.proargnames)
          )
    ),
    0::bigint,
    'contact RPCs accept no workspace, member, or privacy input'
);

select is(
    (
        select count(*)
        from (values ('contacts'), ('contact_points'), ('audit_events')) as table_record(table_name)
        where pg_catalog.has_table_privilege(
            'authenticated',
            pg_catalog.format('public.%I', table_record.table_name),
            'insert, update, delete, truncate'
        )
    ),
    0::bigint,
    'authenticated retains no direct contact or audit write privilege'
);

insert into auth.users (id, email)
values
    ('b1000000-0000-4000-8000-000000000001', 'contact-owner-one@example.invalid'),
    ('b2000000-0000-4000-8000-000000000002', 'contact-owner-two@example.invalid'),
    ('b3000000-0000-4000-8000-000000000003', 'contact-attendant@example.invalid');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Contact Owner One', 'active'),
    ('c2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Contact Owner Two', 'active'),
    ('c3000000-0000-4000-8000-000000000003', 'b3000000-0000-4000-8000-000000000003', 'Contact Attendant', 'active');

insert into public.workspaces (id, name, status, timezone)
values
    ('d1000000-0000-4000-8000-000000000001', 'Contact Workspace One', 'active', 'America/Maceio'),
    ('d2000000-0000-4000-8000-000000000002', 'Contact Workspace Two', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at)
values
    ('e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'owner', 'active', pg_catalog.statement_timestamp()),
    ('e2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 'owner', 'active', pg_catalog.statement_timestamp());

insert into public.workspace_members (
    id,
    workspace_id,
    user_id,
    role,
    status,
    invited_by_member_id,
    invited_email_normalized,
    invited_at,
    activated_at
)
values (
    'e3000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000001',
    'c3000000-0000-4000-8000-000000000003',
    'attendant',
    'active',
    'e1000000-0000-4000-8000-000000000001',
    'contact-attendant@example.invalid',
    pg_catalog.statement_timestamp(),
    pg_catalog.statement_timestamp()
);

insert into public.contacts (
    id,
    workspace_id,
    display_name,
    classification,
    operational_status
)
values (
    'f2000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002',
    'Private Workspace Two Contact',
    'lead',
    'active'
);

set local role authenticated;

select pg_catalog.set_config('request.jwt.claims', '{}'::text, true);

select throws_ok(
    $test$ select public.create_contact('No session', 'lead', null, null) $test$,
    '42501',
    'contact_operation_not_authorized',
    'a sessionless call is rejected'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"b3000000-0000-4000-8000-000000000003","role":"authenticated"}',
    true
);

select throws_ok(
    $test$ select public.create_contact('Attendant write', 'lead', null, null) $test$,
    '42501',
    'contact_operation_not_authorized',
    'an ATTENDANT cannot execute a contact write'
);

select pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true
);

create temporary table created_contact on commit drop as
select public.create_contact(
    'Ana Cliente',
    'lead',
    '+5582999990001',
    '(82) 99999-0001'
) as id;

select is(
    (select count(*) from created_contact),
    1::bigint,
    'an active OWNER can create a contact'
);

select is(
    (
        select array[workspace_id::text, classification, operational_status, is_protected::text]
        from public.contacts
        where id = (select id from created_contact)
    ),
    array['d1000000-0000-4000-8000-000000000001'::text, 'lead', 'active', 'false']::text[],
    'create derives workspace and applies the approved defaults'
);

select is(
    (
        select array[normalized_value, display_value, operational_status, is_protected::text]
        from public.contact_points
        where contact_id = (select id from created_contact)
    ),
    array['+5582999990001', '(82) 99999-0001', 'active', 'false']::text[],
    'create stores the supplied phone atomically with the contact'
);

select is(
    (
        select count(*)
        from public.audit_events
        where target_id = (select id from created_contact)
          and action = 'contact.created'
          and actor_member_id = 'e1000000-0000-4000-8000-000000000001'
    ),
    1::bigint,
    'create records one audit event with the session member as actor'
);

select ok(
    not exists (
        select 1
        from public.audit_events
        where target_id = (select id from created_contact)
          and (
              metadata ? 'display_name'
              or metadata ? 'phone'
              or metadata::text like '%Ana Cliente%'
              or metadata::text like '%999990001%'
          )
    ),
    'create audit metadata contains no contact name or phone PII'
);

select is(
    public.update_contact(
        (select id from created_contact),
        'Ana Atualizada',
        'client',
        '+5582988880002',
        '(82) 98888-0002'
    ),
    (select id from created_contact),
    'an active OWNER can update the supported contact and single phone'
);

select is(
    (
        select array[display_name, classification]
        from public.contacts
        where id = (select id from created_contact)
    ),
    array['Ana Atualizada', 'client']::text[],
    'update changes only the approved contact fields'
);

select is(
    (
        select normalized_value
        from public.contact_points
        where contact_id = (select id from created_contact)
          and operational_status = 'active'
    ),
    '+5582988880002'::text,
    'update changes the one active phone without choosing among multiples'
);

select ok(
    not exists (
        select 1
        from public.audit_events
        where target_id = (select id from created_contact)
          and action = 'contact.updated'
          and (
              metadata ? 'display_name'
              or metadata ? 'phone'
              or metadata::text like '%Ana Atualizada%'
              or metadata::text like '%988880002%'
          )
    ),
    'update audit metadata contains no contact name or phone PII'
);

select is(
    public.set_contact_operational_status((select id from created_contact), 'inactive'),
    (select id from created_contact),
    'an active OWNER can inactivate a contact'
);

select ok(
    exists (
        select 1
        from public.contacts
        where id = (select id from created_contact)
          and operational_status = 'inactive'
          and inactive_at is not null
    ),
    'inactivation maintains the contact lifecycle timestamps'
);

select is(
    public.set_contact_operational_status((select id from created_contact), 'active'),
    (select id from created_contact),
    'an active OWNER can reactivate a contact'
);

select is(
    public.archive_contact((select id from created_contact)),
    (select id from created_contact),
    'an active OWNER can archive a contact without hard deletion'
);

select ok(
    exists (
        select 1
        from public.contacts
        where id = (select id from created_contact)
          and archived_at is not null
    ),
    'archive preserves the contact record'
);

select is(
    public.restore_contact((select id from created_contact)),
    (select id from created_contact),
    'an active OWNER can restore an archived contact'
);

select ok(
    exists (
        select 1
        from public.contacts
        where id = (select id from created_contact)
          and archived_at is null
    ),
    'restore only clears the archive timestamp'
);

create temporary table no_phone_contact on commit drop as
select public.create_contact('Contato Sem Telefone', 'person', null, null) as id;

select is(
    (select id from no_phone_contact),
    (select id from public.contacts where display_name = 'Contato Sem Telefone'),
    'a contact may be created without an optional phone'
);

select is(
    (
        select count(*) from public.contact_points
        where contact_id = (
            select id from public.contacts where display_name = 'Contato Sem Telefone'
        )
    ),
    0::bigint,
    'a phone is not invented when the form omits it'
);

create temporary table reserved_phone_contact on commit drop as
select public.create_contact('Telefone Reservado', 'lead', '+5582977770003', '(82) 97777-0003') as id;

select is(
    (select id from reserved_phone_contact),
    (select id from public.contacts where display_name = 'Telefone Reservado'),
    'a distinct normalized phone can be registered'
);

select throws_ok(
    $test$ select public.create_contact('Duplicado', 'lead', '+5582977770003', '(82) 97777-0003') $test$,
    '23505',
    'contact_phone_duplicate',
    'a duplicate phone in the same workspace is rejected'
);

select is(
    (select count(*) from public.contacts where display_name = 'Duplicado'),
    0::bigint,
    'duplicate phone failure rolls back the contact insert'
);

select is(
    (select count(*) from public.audit_events where action = 'contact.created' and metadata::text like '%Duplicado%'),
    0::bigint,
    'duplicate phone failure rolls back the audit insert and leaks no PII'
);

select throws_ok(
    $test$ select public.create_contact('Telefone Inválido', 'lead', '+551234', '(55) 1234') $test$,
    '22023',
    'contact_phone_invalid',
    'invalid Brazilian phone normalization is rejected by the RPC'
);

select is(
    (select count(*) from public.contacts where display_name = 'Telefone Inválido'),
    0::bigint,
    'invalid phone failure rolls back without a contact'
);

create temporary table international_contact on commit drop as
select public.create_contact('International Contact', 'lead', '+12125550199', '+1 (212) 555-0199') as id;

select is(
    (select normalized_value from public.contact_points where contact_id = (select id from international_contact)),
    '+12125550199'::text,
    'an explicit international E.164 phone is stored canonically'
);

select throws_ok(
    $test$ select public.create_contact('Telefone Longo', 'lead', '+1234567890123456', '+1234567890123456') $test$,
    '22023',
    'contact_phone_invalid',
    'an international phone longer than E.164 is rejected'
);

select throws_ok(
    $test$ select public.update_contact('f2000000-0000-4000-8000-000000000002', 'Tentativa Cruzada', 'client', null, null) $test$,
    'P0001',
    'contact_not_found',
    'an OWNER cannot update a contact from another workspace'
);

reset role;

select is(
    (
        select display_name
        from public.contacts
        where id = 'f2000000-0000-4000-8000-000000000002'
    ),
    'Private Workspace Two Contact'::text,
    'cross-workspace rejection preserves the other workspace contact'
);

insert into public.contacts (
    id,
    workspace_id,
    display_name,
    classification,
    operational_status
)
values (
    'f1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Contato com Multiplos Telefones',
    'lead',
    'active'
);

insert into public.contact_points (
    workspace_id,
    contact_id,
    point_type,
    normalized_value,
    display_value,
    operational_status
)
values
    ('d1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'phone', '+5582966660004', '(82) 96666-0004', 'active'),
    ('d1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'phone', '+5582955550005', '(82) 95555-0005', 'active');

set local role authenticated;

select throws_ok(
    $test$ select public.update_contact('f1000000-0000-4000-8000-000000000001', 'Não Deve Editar', 'client', '+5582944440006', '(82) 94444-0006') $test$,
    'P0001',
    'contact_phone_state_unsupported',
    'editing a contact with multiple active phones is safely rejected'
);

select is(
    (
        select array[display_name, classification]
        from public.contacts
        where id = 'f1000000-0000-4000-8000-000000000001'
    ),
    array['Contato com Multiplos Telefones', 'lead']::text[],
    'multiple-phone rejection does not change the contact'
);

select is(
    (
        select count(*)
        from public.contact_points
        where contact_id = 'f1000000-0000-4000-8000-000000000001'
          and operational_status = 'active'
    ),
    2::bigint,
    'multiple-phone rejection does not remove or select a phone'
);

select throws_ok(
    $test$ update public.contacts set is_protected = true where id = (select id from created_contact) $test$,
    '42501',
    null,
    'direct privacy changes remain unavailable to authenticated'
);

select finish();

rollback;
