begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(23);

-- ─── Fixtures: workspace com OWNER e ATTENDANT, conexão ativa ───────────────────
insert into auth.users (id, email)
values
    ('b3700000-0000-4000-8000-000000000001', 'media-owner@example.test'),
    ('b3700000-0000-4000-8000-000000000002', 'media-attendant@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b3700001-0000-4000-8000-000000000001', 'b3700000-0000-4000-8000-000000000001', 'Media Owner', 'active'),
    ('b3700001-0000-4000-8000-000000000002', 'b3700000-0000-4000-8000-000000000002', 'Media Attendant', 'active');

insert into public.workspaces (id, name, status, timezone)
values ('b3700002-0000-4000-8000-000000000001', 'Media Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b3700003-0000-4000-8000-000000000001', 'b3700002-0000-4000-8000-000000000001', 'b3700001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b3700003-0000-4000-8000-000000000002', 'b3700002-0000-4000-8000-000000000001', 'b3700001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b3700003-0000-4000-8000-000000000001');

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b3700004-0000-4000-8000-000000000001', 'b3700002-0000-4000-8000-000000000001', 'whatsapp', 'media_instance', '+5582999903700', 'active', now());

-- ─── Permissões ──────────────────────────────────────────────────────────────────
select ok(
    not pg_catalog.has_function_privilege('authenticated', 'public.attach_whatsapp_media(uuid,text,text,text,bigint)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.attach_whatsapp_media(uuid,text,text,text,bigint)', 'execute'),
    'attach_whatsapp_media is not executable by authenticated or anon'
);
select ok(
    pg_catalog.has_function_privilege('service_role', 'public.attach_whatsapp_media(uuid,text,text,text,bigint)', 'execute'),
    'attach_whatsapp_media is executable by service_role'
);

-- ─── Ingestão de mídia individual (PDF sem legenda) ─────────────────────────────────
select public.ingest_whatsapp_text_message(
    'media_instance', 'media-pdf-1', '5582988883700@s.whatsapp.net', false, 'Cliente Docs',
    '📄 Documento: holerite.pdf', now() + interval '1 minute'
);

select is(
    (select direction from public.messages where external_message_id = 'media-pdf-1'),
    'incoming',
    'media message is stored as an incoming message (visible to the SLA)'
);

select is(
    public.attach_whatsapp_media(
        (select id from public.messages where external_message_id = 'media-pdf-1'),
        'document', 'holerite.pdf', 'application/pdf', 120000
    )->>'status',
    'success',
    'attach_whatsapp_media registers the attachment'
);

select is(
    (select count(*) from public.attachments where message_id = (select id from public.messages where external_message_id = 'media-pdf-1')),
    1::bigint,
    'exactly one attachment row exists for the media message'
);

select results_eq(
    $$select original_file_name, mime_type, size_bytes, status, storage_bucket from public.attachments
      where message_id = (select id from public.messages where external_message_id = 'media-pdf-1')$$,
    $$values ('holerite.pdf'::text, 'application/pdf'::text, 120000::bigint, 'unavailable'::text, 'whatsapp-media'::text)$$,
    'attachment keeps file name, mime, size and is unavailable until a download exists'
);

select is(
    public.attach_whatsapp_media(
        (select id from public.messages where external_message_id = 'media-pdf-1'),
        'document', 'holerite.pdf', 'application/pdf', 120000
    )->>'status',
    'duplicate',
    'attach_whatsapp_media is idempotent for webhook redeliveries'
);

select is(
    (select count(*) from public.attachments where message_id = (select id from public.messages where external_message_id = 'media-pdf-1')),
    1::bigint,
    'redelivery does not create a second attachment'
);

-- ─── Sanitização e defaults ───────────────────────────────────────────────────────────
select public.ingest_whatsapp_text_message(
    'media_instance', 'media-img-1', '5582988883700@s.whatsapp.net', false, 'Cliente Docs',
    '📷 Imagem', now() + interval '2 minutes'
);
select public.attach_whatsapp_media(
    (select id from public.messages where external_message_id = 'media-img-1'),
    'image', '../etc\passwd', '', null
);

select results_eq(
    $$select original_file_name, mime_type, size_bytes from public.attachments
      where message_id = (select id from public.messages where external_message_id = 'media-img-1')$$,
    $$values ('.._etc_passwd'::text, 'application/octet-stream'::text, 0::bigint)$$,
    'file name has path separators neutralised; missing mime and size use safe defaults'
);

select public.ingest_whatsapp_text_message(
    'media_instance', 'media-audio-1', '5582988883700@s.whatsapp.net', false, 'Cliente Docs',
    '🎤 Mensagem de voz', now() + interval '3 minutes'
);
select public.attach_whatsapp_media(
    (select id from public.messages where external_message_id = 'media-audio-1'),
    'audio', null, 'audio/ogg; codecs=opus', 9000
);
select is(
    (select original_file_name from public.attachments where message_id = (select id from public.messages where external_message_id = 'media-audio-1')),
    'audio',
    'missing file name falls back to a name from the media kind'
);

select is(
    public.attach_whatsapp_media((select id from public.messages where external_message_id = 'media-audio-1'), 'poll', 'x', 'x/y', 1)->>'reason',
    'invalid_media_kind',
    'unknown media kinds are ignored without writing'
);
select throws_ok(
    $$select public.attach_whatsapp_media('b3700009-0000-4000-8000-0000000000ff', 'image', 'x', 'image/png', 1)$$,
    'P0002', 'message_not_found',
    'unknown message raises message_not_found'
);

select throws_ok(
    $$insert into public.attachments (workspace_id, message_id, storage_bucket, storage_key, original_file_name, mime_type, size_bytes, status, available_at)
      select workspace_id, id, 'b', 'avail-zero', 'a.pdf', 'application/pdf', 0, 'available', now() from public.messages where external_message_id = 'media-pdf-1'$$,
    '23514', null,
    'an available attachment must still have a positive size'
);

-- ─── SLA: a mídia recebida é a última mensagem da conversa ──────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b3700000-0000-4000-8000-000000000001';

select is(
    (public.get_conversations_inbox()->'items'->0->>'last_msg_direction'),
    'incoming',
    'inbox last message direction is incoming after a client media message (SLA counts it)'
);
select is(
    (public.get_conversations_inbox()->'items'->0->>'last_msg_text'),
    '🎤 Mensagem de voz',
    'inbox preview shows the media label'
);

-- ─── Leitura de mensagens com anexos ────────────────────────────────────────────────────
select is(
    (select jsonb_array_length(m->'attachments')
     from jsonb_array_elements(public.get_conversation_messages((select id from public.conversations limit 1))->'messages') as m
     where m->>'text_content' = '📄 Documento: holerite.pdf'),
    1,
    'get_conversation_messages returns the attachment metadata'
);
select is(
    (select (m->'attachments'->0->>'file_name') || '|' || (m->'attachments'->0->>'status')
     from jsonb_array_elements(public.get_conversation_messages((select id from public.conversations limit 1))->'messages') as m
     where m->>'text_content' = '📄 Documento: holerite.pdf'),
    'holerite.pdf|unavailable',
    'attachment metadata exposes name and status'
);
select is(
    (select count(*) from public.attachments),
    3::bigint,
    'OWNER sees every attachment'
);

-- ─── ATTENDANT: vê anexo de conversa comercial; não vê o de contato protegido em grupo ──────
reset role;

-- Grupo liberado com mídia de contato público e de contato protegido
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b3700005-0000-4000-8000-000000000002', 'b3700002-0000-4000-8000-000000000001', 'Contato Protegido', 'lead', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b3700006-0000-4000-8000-000000000002', 'b3700002-0000-4000-8000-000000000001', 'b3700005-0000-4000-8000-000000000002', 'phone', '+5582977003700', '(82) 97700-3700', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');

select public.ingest_whatsapp_group_text_message(
    'media_instance', 'media-group-public', '120363003700000001@g.us', '5582988883700@s.whatsapp.net', false,
    'Grupo Docs', 'Cliente Docs', '📄 Documento: grupo-publico.pdf', now() + interval '4 minutes'
);
select public.ingest_whatsapp_group_text_message(
    'media_instance', 'media-group-protected', '120363003700000001@g.us', '5582977003700@s.whatsapp.net', false,
    'Grupo Docs', 'Protegido', '📄 Documento: grupo-protegido.pdf', now() + interval '5 minutes'
);
-- O ingest de grupo cria o remetente; o ponto protegido de teste já existe e é reaproveitado pelo número.
select public.attach_whatsapp_media((select id from public.messages where external_message_id = 'media-group-public'), 'document', 'grupo-publico.pdf', 'application/pdf', 5000);
select public.attach_whatsapp_media((select id from public.messages where external_message_id = 'media-group-protected'), 'document', 'grupo-protegido.pdf', 'application/pdf', 5000);

-- Libera o grupo para a equipe
update public.conversations
set visibility = 'commercial',
    commercial_visible_from = greatest(started_at, created_at),
    privacy_changed_at = greatest(started_at, created_at)
where external_thread_id = '120363003700000001@g.us';

set local role authenticated;
set local "request.jwt.claim.sub" = 'b3700000-0000-4000-8000-000000000002';

select is(
    (select count(*) from public.attachments a join public.messages m on m.id = a.message_id where m.external_message_id = 'media-group-public'),
    1::bigint,
    'ATTENDANT sees the attachment of a released group from an unprotected sender'
);
select is(
    (select count(*) from public.attachments a join public.messages m on m.id = a.message_id where m.external_message_id = 'media-group-protected'),
    0::bigint,
    'ATTENDANT never sees the attachment of a protected contact, even in a released group'
);
select is(
    (select count(*) from public.messages where external_message_id = 'media-group-protected'),
    0::bigint,
    'the protected contact media message itself stays hidden from ATTENDANT'
);
select is(
    (select count(*) from public.attachments a join public.messages m on m.id = a.message_id where m.external_message_id = 'media-pdf-1'),
    1::bigint,
    'ATTENDANT sees the attachment of a commercial individual conversation'
);

select throws_ok(
    $$select public.attach_whatsapp_media((select id from public.messages where external_message_id = 'media-group-public'), 'image', 'x', 'image/png', 1)$$,
    '42501', null,
    'ATTENDANT cannot call attach_whatsapp_media'
);

select * from finish();
rollback;
