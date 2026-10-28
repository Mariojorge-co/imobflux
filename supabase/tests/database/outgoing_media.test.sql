begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(35);

-- ─── Fixtures: workspace A (owner, atendente, conexão ativa) e workspace B (owner) ───────────────
insert into auth.users (id, email)
values
    ('b5400000-0000-4000-8000-000000000001', 'om-owner-a@example.test'),
    ('b5400000-0000-4000-8000-000000000002', 'om-att-a@example.test'),
    ('b5400000-0000-4000-8000-000000000003', 'om-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5400001-0000-4000-8000-000000000001', 'b5400000-0000-4000-8000-000000000001', 'OM Owner A', 'active'),
    ('b5400001-0000-4000-8000-000000000002', 'b5400000-0000-4000-8000-000000000002', 'OM Att A', 'active'),
    ('b5400001-0000-4000-8000-000000000003', 'b5400000-0000-4000-8000-000000000003', 'OM Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b5400002-0000-4000-8000-000000000001', 'OM Workspace A', 'active', 'America/Maceio'),
    ('b5400002-0000-4000-8000-000000000002', 'OM Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5400003-0000-4000-8000-000000000001', 'b5400002-0000-4000-8000-000000000001', 'b5400001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5400003-0000-4000-8000-000000000002', 'b5400002-0000-4000-8000-000000000001', 'b5400001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5400003-0000-4000-8000-000000000001'),
    ('b5400003-0000-4000-8000-000000000003', 'b5400002-0000-4000-8000-000000000002', 'b5400001-0000-4000-8000-000000000003', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b5400004-0000-4000-8000-000000000001', 'b5400002-0000-4000-8000-000000000001', 'whatsapp', 'om_instance', '+5582999905400', 'active', now(), true);

-- Conversa pública (visível ao atendente) e conversa de contato protegido (só o dono)
select public.ingest_whatsapp_text_message('om_instance', 'om-pub-1', '5582988885400@s.whatsapp.net', false, 'Cliente Público', 'Oi', now() - interval '5 minutes');
select public.ingest_whatsapp_text_message('om_instance', 'om-prot-1', '5582988885401@s.whatsapp.net', false, 'Cliente Protegido', 'Oi', now() - interval '5 minutes');
update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988885401');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988885401';

create temp table om_ids on commit drop as
select
    (select c.id from public.conversations c where c.external_thread_id = '5582988885400@s.whatsapp.net') as pub,
    (select c.id from public.conversations c where c.external_thread_id = '5582988885401@s.whatsapp.net') as prot;
grant select on om_ids to authenticated, service_role;

-- ─── Permissões e forma ──────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.queue_outgoing_media_message(uuid,uuid,text,text,text,bigint,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.queue_outgoing_media_message(uuid,uuid,text,text,text,bigint,text)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'public.queue_outgoing_media_message(uuid,uuid,text,text,text,bigint,text)', 'execute'),
    'queue_outgoing_media_message: só usuário autenticado'
);
select ok(
    pg_catalog.has_function_privilege('service_role', 'public.record_outgoing_media_sent(uuid,text)', 'execute')
    and not pg_catalog.has_function_privilege('authenticated', 'public.record_outgoing_media_sent(uuid,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.record_outgoing_media_sent(uuid,text)', 'execute'),
    'record_outgoing_media_sent: só o servidor'
);
select ok(
    pg_catalog.has_function_privilege('service_role', 'public.list_orphan_outbound_uploads(interval)', 'execute')
    and not pg_catalog.has_function_privilege('authenticated', 'public.list_orphan_outbound_uploads(interval)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.list_orphan_outbound_uploads(interval)', 'execute'),
    'list_orphan_outbound_uploads: só o servidor'
);
select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']::text[])
     from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('queue_outgoing_media_message', 'record_outgoing_media_sent', 'list_orphan_outbound_uploads')),
    'funções novas: SECURITY DEFINER com search_path vazio'
);

-- ─── Bucket privado, 50 MiB, sem policies para usuários ───────────────────────────────────────────
select ok(
    (select not b.public and b.file_size_limit = 52428800 from storage.buckets b where b.id = 'whatsapp-media'),
    'bucket whatsapp-media: privado e limitado a 50 MiB (recepção); o envio segue em 25 MiB'
);
select is(
    (select count(*)::int from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (qual like '%whatsapp-media%' or with_check like '%whatsapp-media%')
       and (roles && array['anon', 'authenticated', 'public']::name[])),
    0,
    'sem policy de usuário no bucket: navegador não lê nem grava direto (só URL assinada do servidor)'
);

-- ─── Enfileirar como dono ────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000001';

create temp table om_res (k text primary key, r jsonb);
grant all on om_res to authenticated, service_role;

insert into om_res select 'ok1', public.queue_outgoing_media_message(
    (select pub from om_ids), 'b5400010-0000-4000-8000-000000000001',
    'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000001',
    'contrato final.pdf', 'application/pdf', 123456, 'Segue o contrato');

select is((select r->>'status' from om_res where k = 'ok1'), 'queued', 'dono enfileira um arquivo');
select is((select r->>'instance_name' from om_res where k = 'ok1'), 'om_instance', 'devolve a instância do banco');
select ok((select r->>'recipient_target' from om_res where k = 'ok1') like '5582988885400%', 'devolve o destinatário da conversa');
select is(
    (select count(*)::int from public.messages m where m.id = ((select r->>'message_id' from om_res where k = 'ok1'))::uuid
       and m.direction = 'outgoing' and m.origin = 'crm' and m.status = 'queued' and m.text_content = 'Segue o contrato'),
    1, 'mensagem de saída criada como "na fila" com a legenda'
);
select is(
    (select count(*)::int from public.attachments a where a.id = ((select r->>'attachment_id' from om_res where k = 'ok1'))::uuid
       and a.status = 'available' and a.size_bytes = 123456 and a.mime_type = 'application/pdf'
       and a.original_file_name = 'contrato final.pdf' and a.storage_bucket = 'whatsapp-media'),
    1, 'anexo gravado como disponível, com nome, tipo e tamanho'
);

-- Idempotência: a mesma chave devolve a mesma mensagem
insert into om_res select 'dup', public.queue_outgoing_media_message(
    (select pub from om_ids), 'b5400010-0000-4000-8000-000000000001',
    'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000009',
    'outro.pdf', 'application/pdf', 10, 'Outro');
select is((select r->>'status' from om_res where k = 'dup'), 'duplicate', 'mesma chave de idempotência: não cria outra mensagem');
select is((select r->>'message_id' from om_res where k = 'dup'), (select r->>'message_id' from om_res where k = 'ok1'), 'e devolve a mensagem original');

-- Validações
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 10, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000002/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000002'),
    '22023', 'media_storage_key_invalid', 'caminho de OUTRO workspace é recusado');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 10, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select prot from om_ids) || '/out/b5400020-0000-4000-8000-000000000003'),
    '22023', 'media_storage_key_invalid', 'caminho de OUTRA conversa é recusado');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 10, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/in/b5400020-0000-4000-8000-000000000004'),
    '22023', 'media_storage_key_invalid', 'só o prefixo de saída (/out/) é aceito');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 10, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/../../x'),
    '22023', 'media_storage_key_invalid', 'travessia de caminho (../) é recusada');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 26214401, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000005'),
    '22023', 'media_size_invalid', 'acima de 25 MB é recusado');
select lives_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 26214400, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000006'),
    'exatamente 25 MB é aceito');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 0, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000007'),
    '22023', 'media_size_invalid', 'arquivo vazio é recusado');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'pasta/a.pdf', 'application/pdf', 10, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000008'),
    '22023', 'media_file_name_invalid', 'nome com barra é recusado');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 10, '   ')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-00000000000a'),
    '22023', 'message_content_empty', 'sem legenda nem rótulo é recusado');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.pdf', 'application/pdf', 10, 'x')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-000000000001'),
    '23505', 'media_object_already_used', 'o mesmo arquivo não vira duas mensagens');

-- ─── Atendente: só em conversa a que tem acesso ──────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000002';
select lives_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.jpg', 'image/jpeg', 10, 'foto')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-00000000000b'),
    'atendente envia arquivo em conversa a que tem acesso');
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.jpg', 'image/jpeg', 10, 'foto')$$,
           (select prot from om_ids), 'b5400002-0000-4000-8000-000000000001/' || (select prot from om_ids) || '/out/b5400020-0000-4000-8000-00000000000c'),
    '42501', 'message_enqueue_not_authorized', 'atendente NÃO envia em conversa de contato protegido');

-- ─── Outro workspace ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000003';
select throws_ok(
    format($$select public.queue_outgoing_media_message(%L, gen_random_uuid(), %L, 'a.jpg', 'image/jpeg', 10, 'foto')$$,
           (select pub from om_ids), 'b5400002-0000-4000-8000-000000000002/' || (select pub from om_ids) || '/out/b5400020-0000-4000-8000-00000000000d'),
    '42704', 'conversation_not_available', 'owner de outro workspace não envia na conversa alheia');
select is((select count(*)::int from public.attachments), 0, 'owner de outro workspace não enxerga anexos alheios');

-- anon
reset role;
set local role anon;
select throws_ok(
    $$select public.queue_outgoing_media_message(gen_random_uuid(), gen_random_uuid(), 'x', 'a.pdf', 'application/pdf', 10, 'x')$$,
    '42501', null, 'anon não executa');
reset role;

-- ─── Auditoria do envio (servidor) ───────────────────────────────────────────────────────────────
set local role service_role;
select lives_ok(
    format($$select public.record_outgoing_media_sent(%L, 'document')$$, (select r->>'message_id' from om_res where k = 'ok1')),
    'servidor registra o envio do arquivo na auditoria');
select lives_ok(
    format($$select public.record_outgoing_media_sent(%L, 'document')$$, (select r->>'message_id' from om_res where k = 'ok1')),
    'registrar de novo é idempotente');
select throws_ok(
    format($$select public.record_outgoing_media_sent(%L, 'exe')$$, (select r->>'message_id' from om_res where k = 'ok1')),
    '22023', 'media_kind_invalid', 'tipo de mídia inválido é recusado');
reset role;
select is(
    (select count(*)::int from public.audit_events where action = 'message.file_sent' and target_id = ((select r->>'message_id' from om_res where k = 'ok1'))::uuid),
    1, 'um único evento message.file_sent');
select is(
    (select count(*)::int from public.audit_events where action = 'message.file_sent' and (metadata::text like '%contrato%' or metadata::text like '%.pdf%')),
    0, 'a auditoria não guarda o nome do arquivo');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000001';
select throws_ok(
    format($$select public.record_outgoing_media_sent(%L, 'document')$$, (select r->>'message_id' from om_res where k = 'ok1')),
    '42501', null, 'usuário não registra auditoria de envio (só o servidor)');
reset role;

-- ─── Varredura de órfãos ─────────────────────────────────────────────────────────────────────────
insert into storage.objects (bucket_id, name, created_at)
values
    ('whatsapp-media', 'b5400002-0000-4000-8000-000000000001/b5400030-0000-4000-8000-000000000001/out/b5400040-0000-4000-8000-000000000001', now() - interval '3 days'),
    ('whatsapp-media', 'b5400002-0000-4000-8000-000000000001/b5400030-0000-4000-8000-000000000001/out/b5400040-0000-4000-8000-000000000002', now()),
    ('whatsapp-media', 'b5400002-0000-4000-8000-000000000001/b5400030-0000-4000-8000-000000000001/in/b5400040-0000-4000-8000-000000000003', now() - interval '3 days');
insert into storage.objects (bucket_id, name, created_at)
select 'whatsapp-media', a.storage_key, now() - interval '3 days'
from public.attachments a where a.id = ((select r->>'attachment_id' from om_res where k = 'ok1'))::uuid;
set local role service_role;
select is(
    (select array_agg(n order by n) from public.list_orphan_outbound_uploads(interval '1 day') as n where n like 'b5400002-%'),
    array['b5400002-0000-4000-8000-000000000001/b5400030-0000-4000-8000-000000000001/out/b5400040-0000-4000-8000-000000000001']::text[],
    'varredura lista só o upload antigo SEM mensagem (não o recente, não o de entrada, não o que virou anexo)'
);
reset role;

select * from finish();
rollback;
