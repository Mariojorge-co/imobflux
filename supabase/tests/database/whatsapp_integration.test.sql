begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(31);

-- ─── 1. Setup de Fixtures de Teste ───────────────────────────────────────────

insert into auth.users (id, email)
values
    ('10000000-0000-4000-8000-000000000099', 'wa_owner@example.test'),
    ('10000000-0000-4000-8000-000000000098', 'wa_other@example.test')
on conflict (id) do nothing;

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('11000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000099', 'WA Owner', 'active'),
    ('11000000-0000-4000-8000-000000000098', '10000000-0000-4000-8000-000000000098', 'WA Other', 'active')
on conflict (id) do nothing;

insert into public.workspaces (id, name, status, timezone)
values
    ('21000000-0000-4000-8000-000000000099', 'WA Workspace 1', 'active', 'America/Maceio'),
    ('21000000-0000-4000-8000-000000000098', 'WA Workspace 2', 'active', 'America/Maceio')
on conflict (id) do nothing;

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at)
values
    ('31000000-0000-4000-8000-000000000099', '21000000-0000-4000-8000-000000000099', '11000000-0000-4000-8000-000000000099', 'owner', 'active', now()),
    ('31000000-0000-4000-8000-000000000098', '21000000-0000-4000-8000-000000000098', '11000000-0000-4000-8000-000000000098', 'owner', 'active', now())
on conflict (id) do nothing;

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values
    ('61000000-0000-4000-8000-000000000099', '21000000-0000-4000-8000-000000000099', 'whatsapp', 'instance_test_99', '+5582999990099', 'active', now()),
    ('61000000-0000-4000-8000-000000000098', '21000000-0000-4000-8000-000000000098', 'whatsapp', 'instance_test_98', '+5582999990098', 'active', now())
on conflict (id) do nothing;


-- ─── 2. Testes de Permissões das RPCs ────────────────────────────────────────

select ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.ingest_whatsapp_text_message(text,text,text,boolean,text,text,timestamptz)',
        'execute'
    ),
    'ingest_whatsapp_text_message is revoked from authenticated'
);

select ok(
    not pg_catalog.has_function_privilege(
        'authenticated',
        'public.reconcile_outgoing_text_message(uuid,text,text)',
        'execute'
    ),
    'reconcile_outgoing_text_message is revoked from authenticated'
);

select ok(
    pg_catalog.has_function_privilege(
        'authenticated',
        'public.queue_outgoing_text_message(uuid,text,uuid)',
        'execute'
    ),
    'queue_outgoing_text_message is executable by authenticated'
);


-- ─── 3. Teste de Ingestão Incoming (fromMe = false) ──────────────────────────

select lives_ok(
    $$
        select public.ingest_whatsapp_text_message(
            'instance_test_99',
            'msg_ext_incoming_1',
            '5582988881111@s.whatsapp.net',
            false,
            'Cliente Joao',
            'Ola, quero comprar um imovel',
            now()
        );
    $$,
    'ingest_whatsapp_text_message ingests incoming text successfully'
);

select is(
    (select display_name from public.contacts where workspace_id = '21000000-0000-4000-8000-000000000099' limit 1),
    'Cliente Joao',
    'creates contact with pushName for incoming fromMe=false'
);

select is(
    (select classification from public.contacts where workspace_id = '21000000-0000-4000-8000-000000000099' limit 1),
    'person',
    'new unknown contact has classification = person'
);

select is(
    (select direction from public.messages where external_message_id = 'msg_ext_incoming_1'),
    'incoming',
    'incoming message has direction = incoming'
);

select is(
    (select origin from public.messages where external_message_id = 'msg_ext_incoming_1'),
    'whatsapp',
    'incoming message has origin = whatsapp'
);

select is(
    (select status from public.messages where external_message_id = 'msg_ext_incoming_1'),
    'received',
    'incoming message has status = received'
);

select ok(
    (select sender_contact_point_id from public.messages where external_message_id = 'msg_ext_incoming_1') is not null,
    'incoming message has sender_contact_point_id set'
);


-- ─── 4. Teste de Ingestão Outgoing Direta (fromMe = true) ─────────────────────

select lives_ok(
    $$
        select public.ingest_whatsapp_text_message(
            'instance_test_99',
            'msg_ext_outgoing_app_1',
            '5582988882222@s.whatsapp.net',
            true,
            'Ignored PushName',
            'Resposta enviada direto do celular',
            now()
        );
    $$,
    'ingest_whatsapp_text_message ingests outgoing fromMe=true successfully'
);

select is(
    (select display_name from public.contacts where id = (select contact_id from public.contact_points where normalized_value = '+5582988882222')),
    'Contato +5582988882222',
    'fromMe=true uses neutral phone format for new contact instead of pushName'
);

select is(
    (select direction from public.messages where external_message_id = 'msg_ext_outgoing_app_1'),
    'outgoing',
    'fromMe=true message has direction = outgoing'
);

select is(
    (select origin from public.messages where external_message_id = 'msg_ext_outgoing_app_1'),
    'whatsapp',
    'fromMe=true message has origin = whatsapp'
);

select is(
    (select internal_author_member_id from public.messages where external_message_id = 'msg_ext_outgoing_app_1'),
    null,
    'fromMe=true message has internal_author_member_id = null'
);

select is(
    (select sender_contact_point_id from public.messages where external_message_id = 'msg_ext_outgoing_app_1'),
    null,
    'fromMe=true message has sender_contact_point_id = null'
);


-- ─── 5. Teste de Idempotência Externa (Webhook Repetido) ─────────────────────

select is(
    (
        select public.ingest_whatsapp_text_message(
            'instance_test_99',
            'msg_ext_incoming_1',
            '5582988881111@s.whatsapp.net',
            false,
            'Cliente Joao',
            'Ola, quero comprar um imovel',
            now()
        )->>'status'
    ),
    'duplicate',
    're-ingesting duplicate external_message_id returns duplicate status'
);

select is(
    (select count(*) from public.messages where external_message_id = 'msg_ext_incoming_1'),
    1::bigint,
    'duplicate webhook does not create extra message record'
);


-- ─── 6. Teste de Tratamento de Grupos (@g.us) ────────────────────────────────

select is(
    (
        select public.ingest_whatsapp_text_message(
            'instance_test_99',
            'msg_group_1',
            '120363000000000000@g.us',
            false,
            'Grupo Imobiliaria',
            'Mensagem no grupo',
            now()
        )->>'status'
    ),
    'ignored',
    'group remoteJid is ignored gracefully'
);


-- ─── 7. Teste de Fila Local de Envio (queue_outgoing_text_message) ──────────

set request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000099","role":"authenticated"}';
set role authenticated;

select throws_ok(
    $$
        select public.queue_outgoing_text_message(
            '99000000-0000-4000-8000-000000000099'::uuid,
            'Texto de teste',
            '77000000-0000-4000-8000-000000000001'::uuid
        )
    $$,
    '42704',
    null,
    'queue_outgoing_text_message fails when conversation does not exist'
);

select lives_ok(
    $$
        select public.queue_outgoing_text_message(
            (select id from public.conversations where external_thread_id = '5582988881111@s.whatsapp.net' limit 1),
            'Resposta enviada via CRM',
            '77000000-0000-4000-8000-000000000001'::uuid
        )
    $$,
    'queue_outgoing_text_message queues outgoing message for authenticated member'
);

select is(
    (select status from public.messages where client_idempotency_key = '77000000-0000-4000-8000-000000000001'),
    'queued',
    'queued message status is queued'
);

select is(
    (select origin from public.messages where client_idempotency_key = '77000000-0000-4000-8000-000000000001'),
    'crm',
    'queued message origin is crm'
);

-- Idempotência Local
select is(
    (
        select public.queue_outgoing_text_message(
            (select id from public.conversations where external_thread_id = '5582988881111@s.whatsapp.net' limit 1),
            'Resposta enviada via CRM',
            '77000000-0000-4000-8000-000000000001'::uuid
        )->>'status'
    ),
    'duplicate',
    'queue_outgoing_text_message returns duplicate on duplicate client_idempotency_key'
);


-- ─── 8. Teste de Reconciliação (queued → sent e queued → failed) ─────────────

reset role;

select lives_ok(
    $$
        select public.reconcile_outgoing_text_message(
            (select id from public.messages where client_idempotency_key = '77000000-0000-4000-8000-000000000001'),
            'sent',
            'ext_msg_reconciled_1'
        );
    $$,
    'reconcile_outgoing_text_message transitions queued to sent'
);

select is(
    (select status from public.messages where client_idempotency_key = '77000000-0000-4000-8000-000000000001'),
    'sent',
    'reconciled message status is sent'
);

select is(
    (select external_message_id from public.messages where client_idempotency_key = '77000000-0000-4000-8000-000000000001'),
    'ext_msg_reconciled_1',
    'reconciled message has external_message_id updated'
);

-- Enfileirar segunda mensagem para testar queued → failed
set request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000099","role":"authenticated"}';
set role authenticated;

select lives_ok(
    $$
        select public.queue_outgoing_text_message(
            (select id from public.conversations where external_thread_id = '5582988881111@s.whatsapp.net' limit 1),
            'Mensagem que vai falhar',
            '77000000-0000-4000-8000-000000000002'::uuid
        )
    $$,
    'queue_outgoing_text_message queues second message'
);

reset role;

select lives_ok(
    $$
        select public.reconcile_outgoing_text_message(
            (select id from public.messages where client_idempotency_key = '77000000-0000-4000-8000-000000000002'),
            'failed',
            null
        );
    $$,
    'reconcile_outgoing_text_message transitions queued to failed'
);

select is(
    (select status from public.messages where client_idempotency_key = '77000000-0000-4000-8000-000000000002'),
    'failed',
    'reconciled message status is failed'
);


-- ─── 9. Teste de Isolamento de Workspace e Rollback em Falha ─────────────────

select throws_ok(
    $$
        select public.ingest_whatsapp_text_message(
            'non_existent_instance',
            'msg_ext_isolated_1',
            '5582988881111@s.whatsapp.net',
            false,
            'Nome',
            'Texto',
            now()
        );
    $$,
    '42704',
    null,
    'ingest_whatsapp_text_message fails when instance/channel_connection is not found'
);

select finish();
rollback;
