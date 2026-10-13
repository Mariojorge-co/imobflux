begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(34);

insert into auth.users (id, email)
values
    ('c4000000-0000-4000-8000-000000000001', 'chan-owner@example.test'),
    ('c4000000-0000-4000-8000-000000000002', 'chan-attendant@example.test'),
    ('c4000000-0000-4000-8000-000000000003', 'chan-other-owner@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('c4000001-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'Chan Owner', 'active'),
    ('c4000001-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', 'Chan Attendant', 'active'),
    ('c4000001-0000-4000-8000-000000000003', 'c4000000-0000-4000-8000-000000000003', 'Other Owner', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('c4000002-0000-4000-8000-000000000001', 'Chan Workspace', 'active', 'America/Maceio'),
    ('c4000002-0000-4000-8000-000000000002', 'Other Chan Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('c4000003-0000-4000-8000-000000000001', 'c4000002-0000-4000-8000-000000000001', 'c4000001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('c4000003-0000-4000-8000-000000000002', 'c4000002-0000-4000-8000-000000000001', 'c4000001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'c4000003-0000-4000-8000-000000000001'),
    ('c4000003-0000-4000-8000-000000000003', 'c4000002-0000-4000-8000-000000000002', 'c4000001-0000-4000-8000-000000000003', 'owner', 'active', now(), null);
-- Instância que já pertence a OUTRO workspace
insert into public.channel_connections (id, workspace_id, provider, external_account_id, status)
values ('c4000004-0000-4000-8000-000000000009', 'c4000002-0000-4000-8000-000000000002', 'whatsapp', 'imobflux-other', 'configured');

-- ─── Permissões ───────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.register_whatsapp_channel(text)', 'execute')
    and pg_catalog.has_function_privilege('authenticated', 'public.confirm_whatsapp_channel_state(text,text,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.register_whatsapp_channel(text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.confirm_whatsapp_channel_state(text,text,text)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'public.register_whatsapp_channel(text)', 'execute'),
    'register/confirm are for authenticated users only (the function itself requires the OWNER)'
);
select ok(
    pg_catalog.has_function_privilege('service_role', 'public.sync_whatsapp_channel_state(text,text,text)', 'execute')
    and not pg_catalog.has_function_privilege('authenticated', 'public.sync_whatsapp_channel_state(text,text,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.sync_whatsapp_channel_state(text,text,text)', 'execute'),
    'sync is for the server (service_role) only'
);
select ok(
    not pg_catalog.has_function_privilege('authenticated', 'private.apply_whatsapp_channel_state(uuid,text,text,uuid)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'private.apply_whatsapp_channel_state(uuid,text,text,uuid)', 'execute'),
    'the internal state function is not callable by users or the server directly'
);

-- ─── ATTENDANT não conecta nem vê a conexão ──────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'c4000000-0000-4000-8000-000000000002';
select throws_ok(
    $$select public.register_whatsapp_channel('imobflux-chan01')$$,
    '42501', 'whatsapp_channel_not_authorized',
    'ATTENDANT cannot register a WhatsApp connection'
);
select throws_ok(
    $$select public.confirm_whatsapp_channel_state('imobflux-other', 'close', null)$$,
    '42501', 'whatsapp_channel_not_authorized',
    'ATTENDANT cannot change the connection state'
);

-- ─── OWNER registra ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'c4000000-0000-4000-8000-000000000001';

select throws_ok(
    $$select public.register_whatsapp_channel('Nome Inválido!')$$,
    '22023', 'invalid_whatsapp_instance_name',
    'instance names are validated'
);
select throws_ok(
    $$select public.register_whatsapp_channel('imobflux-other')$$,
    '42501', 'whatsapp_instance_in_use',
    'an instance that belongs to another workspace cannot be taken'
);
select is(
    public.register_whatsapp_channel('imobflux-chan01')->>'connection_status',
    'configured',
    'OWNER registers the instance as configured (waiting for the QR code)'
);
select is(
    (select count(*) from public.channel_connections where external_account_id = 'imobflux-chan01'),
    1::bigint,
    'one connection row was created'
);
select is(
    public.register_whatsapp_channel('imobflux-chan01')->>'connection_id',
    (select id::text from public.channel_connections where external_account_id = 'imobflux-chan01'),
    'registering again is idempotent (same connection)'
);
select is(
    (select count(*) from public.audit_events where action = 'whatsapp.channel_registered'),
    1::bigint,
    'registration is audited once (the repeat is not)'
);

-- ─── Confirmação do estado ───────────────────────────────────────────────────────────────────────
select is(
    public.confirm_whatsapp_channel_state('imobflux-chan01', 'open', null)->>'reason',
    'phone_required',
    'an open state without a number is not enough to activate'
);
select throws_ok(
    $$select public.confirm_whatsapp_channel_state('imobflux-chan01', 'open', '82999990000')$$,
    '22023', 'invalid_whatsapp_phone',
    'the number must be in E.164 format'
);
select throws_ok(
    $$select public.confirm_whatsapp_channel_state('imobflux-chan01', 'connecting', null)$$,
    '22023', 'invalid_whatsapp_channel_state',
    'only open/close are accepted'
);
select throws_ok(
    $$select public.confirm_whatsapp_channel_state('imobflux-other', 'open', '+5582999990000')$$,
    'P0002', 'whatsapp_channel_not_found',
    'OWNER cannot confirm another workspace connection'
);
select is(
    public.confirm_whatsapp_channel_state('imobflux-chan01', 'open', '+5582999990000')->>'connection_status',
    'active',
    'OWNER activates the connection with the paired number'
);
select results_eq(
    $$select status, external_phone_normalized, activated_at is not null, disconnected_at is null
      from public.channel_connections where external_account_id = 'imobflux-chan01'$$,
    $$values ('active'::text, '+5582999990000'::text, true, true)$$,
    'active connection keeps the number and a valid lifecycle'
);
select is(
    public.confirm_whatsapp_channel_state('imobflux-chan01', 'open', '+5582999990000')->>'changed',
    'false',
    'confirming the same state again changes nothing'
);
select is(
    (select count(*) from public.audit_events where action = 'whatsapp.channel_connected'),
    1::bigint,
    'only the real transition is audited'
);
select is(
    public.confirm_whatsapp_channel_state('imobflux-chan01', 'open', '+5582988880000')->>'changed',
    'true',
    'a different number on the same connection is recorded'
);

-- ─── A conexão ativa liga a ingestão; desconectar desliga ──────────────────────────────────────────
reset role;
select lives_ok(
    $$select public.ingest_whatsapp_text_message('imobflux-chan01', 'chan-msg-1', '5582977770000@s.whatsapp.net', false, 'Cliente', 'Olá', now())$$,
    'messages are ingested for an active connection'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'c4000000-0000-4000-8000-000000000001';
select is(
    public.confirm_whatsapp_channel_state('imobflux-chan01', 'close', null)->>'connection_status',
    'disconnected',
    'OWNER disconnects the connection'
);
reset role;
select throws_ok(
    $$select public.ingest_whatsapp_text_message('imobflux-chan01', 'chan-msg-2', '5582977770001@s.whatsapp.net', false, 'Cliente', 'Olá', now())$$,
    '42704', 'active_whatsapp_connection_not_found',
    'a disconnected connection no longer ingests messages'
);
select is(
    (select count(*) from public.audit_events where action = 'whatsapp.channel_disconnected' and actor_type = 'member'),
    1::bigint,
    'the OWNER disconnection is audited with the member as actor'
);

-- ─── Reconectar: registrar de novo rearma a mesma conexão ─────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'c4000000-0000-4000-8000-000000000001';
select results_eq(
    $$select public.register_whatsapp_channel('imobflux-chan01')->>'connection_status'$$,
    $$values ('configured'::text)$$,
    're-registering a disconnected connection re-arms it for a new QR code'
);
select results_eq(
    $$select activated_at is null and disconnected_at is null from public.channel_connections where external_account_id = 'imobflux-chan01'$$,
    $$values (true)$$,
    'the re-armed connection has a clean lifecycle'
);

-- ─── Webhook do provedor (service_role) ────────────────────────────────────────────────────────────────
reset role;
select is(
    public.sync_whatsapp_channel_state('imobflux-desconhecida', 'close', null)->>'reason',
    'unknown_instance',
    'a provider event for an unknown instance is ignored'
);
select is(
    public.sync_whatsapp_channel_state('imobflux-chan01', 'close', null)->>'changed',
    'false',
    'a close event while still waiting for the QR code does not mark it disconnected'
);
select is(
    public.sync_whatsapp_channel_state('imobflux-chan01', 'open', '+5582966660000')->>'connection_status',
    'active',
    'a provider open event with the number activates the connection'
);
select is(
    public.sync_whatsapp_channel_state('imobflux-chan01', 'close', null)->>'connection_status',
    'disconnected',
    'a provider close event disconnects an active connection (e.g. logged out from the phone)'
);
select is(
    (select count(*) from public.audit_events where action = 'whatsapp.channel_disconnected' and actor_type = 'system'),
    1::bigint,
    'provider-driven changes are audited with the system as actor'
);

-- ─── Uma conexão ativa por workspace: a nova substitui a antiga ────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'c4000000-0000-4000-8000-000000000001';
select public.confirm_whatsapp_channel_state('imobflux-chan01', 'open', '+5582966660000');
select public.register_whatsapp_channel('imobflux-chan02');
select public.confirm_whatsapp_channel_state('imobflux-chan02', 'open', '+5582955550000');
select results_eq(
    $$select external_account_id, status from public.channel_connections where workspace_id = 'c4000002-0000-4000-8000-000000000001' order by external_account_id$$,
    $$values ('imobflux-chan01'::text, 'replaced'::text), ('imobflux-chan02'::text, 'active'::text)$$,
    'pairing a new instance replaces the previous active one (one active connection per workspace)'
);

-- ─── Visibilidade ─────────────────────────────────────────────────────────────────────────────────────────
select is(
    (select count(*) from public.channel_connections),
    2::bigint,
    'OWNER sees only the connections of the own workspace'
);
set local "request.jwt.claim.sub" = 'c4000000-0000-4000-8000-000000000002';
select is(
    (select count(*) from public.channel_connections),
    0::bigint,
    'ATTENDANT cannot read connections'
);

select * from finish();
rollback;
