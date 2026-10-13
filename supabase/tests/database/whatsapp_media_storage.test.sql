begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(26);

insert into auth.users (id, email)
values
    ('c3900000-0000-4000-8000-000000000001', 'storage-owner@example.test'),
    ('c3900000-0000-4000-8000-000000000002', 'storage-attendant@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('c3900001-0000-4000-8000-000000000001', 'c3900000-0000-4000-8000-000000000001', 'Storage Owner', 'active'),
    ('c3900001-0000-4000-8000-000000000002', 'c3900000-0000-4000-8000-000000000002', 'Storage Attendant', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('c3900002-0000-4000-8000-000000000001', 'Storage Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('c3900003-0000-4000-8000-000000000001', 'c3900002-0000-4000-8000-000000000001', 'c3900001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('c3900003-0000-4000-8000-000000000002', 'c3900002-0000-4000-8000-000000000001', 'c3900001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'c3900003-0000-4000-8000-000000000001');
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('c3900004-0000-4000-8000-000000000001', 'c3900002-0000-4000-8000-000000000001', 'whatsapp', 'storage_instance', '+5582999903900', 'active', now());

-- ─── Bucket privado ────────────────────────────────────────────────────────────────────
select is(
    (select public from storage.buckets where id = 'whatsapp-media'),
    false,
    'whatsapp-media bucket exists and is private'
);
select is(
    (select file_size_limit from storage.buckets where id = 'whatsapp-media'),
    26214400::bigint,
    'bucket limits files to 25 MB'
);

-- ─── Anexo nasce 'pending' ───────────────────────────────────────────────────────────────
select public.ingest_whatsapp_text_message('storage_instance', 'storage-msg-1', '5582988883900@s.whatsapp.net', false, 'Cliente Storage', '📄 Documento: contrato.pdf', now());

select is(
    public.attach_whatsapp_media((select id from public.messages where external_message_id = 'storage-msg-1'), 'document', 'contrato.pdf', 'application/pdf', null)->>'attachment_status',
    'pending',
    'a new attachment is created as pending (a download is scheduled right after ingestion)'
);
select is(
    (select status from public.attachments where message_id = (select id from public.messages where external_message_id = 'storage-msg-1')),
    'pending',
    'stored status is pending'
);
select is(
    public.attach_whatsapp_media((select id from public.messages where external_message_id = 'storage-msg-1'), 'document', 'contrato.pdf', 'application/pdf', null)->>'attachment_status',
    'pending',
    'a redelivery reports the current attachment status'
);

-- ─── Permissões ──────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('service_role', 'public.mark_attachment_available(uuid,bigint,text,text)', 'execute')
    and pg_catalog.has_function_privilege('service_role', 'public.mark_attachment_download_state(uuid,text)', 'execute'),
    'service_role can execute the attachment lifecycle functions'
);
select ok(
    not pg_catalog.has_function_privilege('authenticated', 'public.mark_attachment_available(uuid,bigint,text,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.mark_attachment_available(uuid,bigint,text,text)', 'execute')
    and not pg_catalog.has_function_privilege('authenticated', 'public.mark_attachment_download_state(uuid,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.mark_attachment_download_state(uuid,text)', 'execute'),
    'authenticated and anon cannot execute the attachment lifecycle functions'
);

-- ─── Estados de download ───────────────────────────────────────────────────────────────────
select is(
    public.mark_attachment_download_state((select id from public.attachments limit 1), 'unavailable')->>'attachment_status',
    'unavailable',
    'a failed download moves the attachment to unavailable'
);
select is(
    public.mark_attachment_download_state((select id from public.attachments limit 1), 'pending')->>'attachment_status',
    'pending',
    'a retry moves it back to pending'
);
select throws_ok(
    $$select public.mark_attachment_download_state((select id from public.attachments limit 1), 'available')$$,
    '22023', 'invalid_attachment_state',
    'download state cannot be used to mark a file available'
);
select is(
    public.mark_attachment_download_state('c3900009-0000-4000-8000-0000000000ff', 'pending')->>'status',
    'not_found',
    'unknown attachment is reported as not_found'
);

-- ─── Marcar disponível ───────────────────────────────────────────────────────────────────────
select throws_ok(
    $$select public.mark_attachment_available((select id from public.attachments limit 1), 0, 'application/pdf', null)$$,
    '22023', 'invalid_attachment_size',
    'an available attachment needs a positive size'
);
select is(
    public.mark_attachment_available(
        (select id from public.attachments limit 1), 123456, 'application/pdf',
        'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789'
    )->>'status',
    'success',
    'mark_attachment_available stores the final size, mime and checksum'
);
select results_eq(
    $$select status, size_bytes, mime_type, sha256, available_at is not null and available_at >= created_at
      from public.attachments limit 1$$,
    $$values ('available'::text, 123456::bigint, 'application/pdf'::text, 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'::text, true)$$,
    'attachment is available with a lowercase checksum and a valid available_at'
);
select is(
    public.mark_attachment_available((select id from public.attachments limit 1), 999, 'image/png', null)->>'status',
    'duplicate',
    'marking an available attachment again is idempotent'
);
select is(
    (select size_bytes from public.attachments limit 1),
    123456::bigint,
    'an idempotent repeat does not overwrite the stored file data'
);
select is(
    public.mark_attachment_download_state((select id from public.attachments limit 1), 'unavailable')->>'status',
    'ignored',
    'a stored file is never downgraded by a late failure'
);
select is(
    public.mark_attachment_available('c3900009-0000-4000-8000-0000000000ff', 10, 'image/png', null)->>'status',
    'not_found',
    'unknown attachment is reported as not_found'
);

-- ─── Contexto do download (a service_role não tem SELECT direto nas tabelas) ────────────────
select ok(
    pg_catalog.has_function_privilege('service_role', 'public.get_attachment_download_context(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('authenticated', 'public.get_attachment_download_context(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.get_attachment_download_context(uuid)', 'execute'),
    'get_attachment_download_context is executable only by service_role'
);
select results_eq(
    $$select c->>'instance', c->>'external_message_id', c->>'remote_jid', c->>'conversation_type', c->>'storage_bucket', (c->>'from_me')::boolean, c->>'participant_phone'
      from (select public.get_attachment_download_context((select id from public.attachments limit 1)) as c) as x$$,
    $$values ('storage_instance'::text, 'storage-msg-1'::text, '5582988883900@s.whatsapp.net'::text, 'individual'::text, 'whatsapp-media'::text, false, null::text)$$,
    'the download context locates the provider instance, message and conversation'
);

select public.ingest_whatsapp_group_text_message('storage_instance', 'storage-group-1', '120363003900000001@g.us', '5582988883901@s.whatsapp.net', false, 'Grupo Storage', 'Remetente', '🖼️ Imagem', now());
select public.attach_whatsapp_media((select id from public.messages where external_message_id = 'storage-group-1'), 'image', null, 'image/png', 10);
select results_eq(
    $$select c->>'conversation_type', c->>'remote_jid', c->>'participant_phone', c->>'status'
      from (select public.get_attachment_download_context((select a.id from public.attachments a join public.messages m on m.id = a.message_id where m.external_message_id = 'storage-group-1')) as c) as x$$,
    $$values ('group'::text, '120363003900000001@g.us'::text, '+5582988883901'::text, 'pending'::text)$$,
    'for a group message the context also identifies the sender participant'
);
select is(
    public.get_attachment_download_context('c3900009-0000-4000-8000-0000000000ff'),
    null::jsonb,
    'unknown attachment has no download context'
);
-- ─── Objetos do bucket não são legíveis pelos usuários ───────────────────────────────────────
insert into storage.objects (bucket_id, name)
select 'whatsapp-media', storage_key from public.attachments limit 1;

set local role authenticated;
set local "request.jwt.claim.sub" = 'c3900000-0000-4000-8000-000000000001';

select is(
    (select count(*) from storage.objects where bucket_id = 'whatsapp-media'),
    0::bigint,
    'even the OWNER cannot list private bucket objects directly (only the authorised server route can sign them)'
);
select is(
    (select m->'attachments'->0->>'status' from jsonb_array_elements(public.get_conversation_messages((select id from public.conversations limit 1))->'messages') as m limit 1),
    'available',
    'the conversation read model exposes the attachment status'
);
select ok(
    (select (m->'attachments'->0->>'created_at') is not null from jsonb_array_elements(public.get_conversation_messages((select id from public.conversations limit 1))->'messages') as m limit 1),
    'the conversation read model exposes the attachment creation time'
);

set local "request.jwt.claim.sub" = 'c3900000-0000-4000-8000-000000000002';
select is(
    (select count(*) from storage.objects where bucket_id = 'whatsapp-media'),
    0::bigint,
    'ATTENDANT cannot list private bucket objects either'
);

select * from finish();
rollback;
