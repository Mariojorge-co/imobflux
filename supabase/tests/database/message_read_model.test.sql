begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(35);

insert into auth.users (id, email)
values
    ('b6000000-0000-4000-8000-000000000001', 'rm-owner@example.test'),
    ('b6000000-0000-4000-8000-000000000002', 'rm-att1@example.test'),
    ('b6000000-0000-4000-8000-000000000003', 'rm-att2@example.test'),
    ('b6000000-0000-4000-8000-000000000004', 'rm-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b6000001-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001', 'RM Owner', 'active'),
    ('b6000001-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000002', 'RM Att1', 'active'),
    ('b6000001-0000-4000-8000-000000000003', 'b6000000-0000-4000-8000-000000000003', 'RM Att2', 'active'),
    ('b6000001-0000-4000-8000-000000000004', 'b6000000-0000-4000-8000-000000000004', 'RM Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b6000002-0000-4000-8000-000000000001', 'RM Workspace A', 'active', 'America/Maceio'),
    ('b6000002-0000-4000-8000-000000000002', 'RM Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b6000003-0000-4000-8000-000000000001', 'b6000002-0000-4000-8000-000000000001', 'b6000001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b6000003-0000-4000-8000-000000000002', 'b6000002-0000-4000-8000-000000000001', 'b6000001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b6000003-0000-4000-8000-000000000001'),
    ('b6000003-0000-4000-8000-000000000003', 'b6000002-0000-4000-8000-000000000001', 'b6000001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b6000003-0000-4000-8000-000000000001'),
    ('b6000003-0000-4000-8000-000000000004', 'b6000002-0000-4000-8000-000000000002', 'b6000001-0000-4000-8000-000000000004', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b6000004-0000-4000-8000-000000000001', 'b6000002-0000-4000-8000-000000000001', 'whatsapp', 'rm_instance', '+5582999906000', 'active', now(), true);

-- 7 conversas de cliente (para o limite de 5 fixadas) + 1 protegida
select public.ingest_whatsapp_text_message('rm_instance', 'rm-' || n, '558298888600' || n || '@s.whatsapp.net', false, 'Cliente ' || n, 'Oi ' || n, now() - (n || ' hours')::interval)
from generate_series(1, 7) as n;
select public.ingest_whatsapp_text_message('rm_instance', 'rm-prot', '5582988886100@s.whatsapp.net', false, 'Protegido', 'Oi', now() - interval '10 hours');
update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988886100');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988886100';

create temp table rm_c on commit drop as
select n, (select id from public.conversations where external_thread_id = '558298888600' || n || '@s.whatsapp.net') as id from generate_series(1, 7) as n;
grant select on rm_c to authenticated;
create temp table rm_prot on commit drop as select (select id from public.conversations where external_thread_id = '5582988886100@s.whatsapp.net') as id;
grant select on rm_prot to authenticated;

-- Conversa 1: mensagens do cliente e do CRM (att1)
insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, external_message_id, client_idempotency_key, direction, origin, internal_author_member_id, text_content, status, occurred_at)
select ('b6000005-0000-4000-8000-00000000000' || x.k)::uuid, c.workspace_id, c.channel_connection_id, c.id, 'rm-crm-' || x.k, gen_random_uuid(), 'outgoing', 'crm',
       'b6000003-0000-4000-8000-000000000002', x.t, 'sent', now() - x.age
from public.conversations c, (values (1, 'Resposta normal', interval '50 minutes'), (2, 'Mensagem que será escondida', interval '1 minute'), (3, 'Mensagem que será apagada', interval '55 minutes')) as x(k, t, age)
where c.id = (select id from rm_c where n = 1);
insert into public.attachments (workspace_id, message_id, storage_bucket, storage_key, original_file_name, mime_type, size_bytes, status, available_at)
values ('b6000002-0000-4000-8000-000000000001', 'b6000005-0000-4000-8000-000000000003', 'whatsapp-media', 'b6000002-0000-4000-8000-000000000001/x/out/b6000006-0000-4000-8000-000000000001', 'secreto.pdf', 'application/pdf', 10, 'available', now());

-- ações (como o servidor/usuário fariam)
select public.set_message_reply('b6000005-0000-4000-8000-000000000001', (select id from public.messages where external_message_id = 'rm-1'))
from (select 1) s where false;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6000000-0000-4000-8000-000000000002';
select public.set_message_reply('b6000005-0000-4000-8000-000000000001', (select id from public.messages where external_message_id = 'rm-1'));
select public.hide_message('b6000005-0000-4000-8000-000000000002');
reset role;
set local role service_role;
select public.commit_message_edit('b6000005-0000-4000-8000-000000000001', 'Resposta editada', 'b6000003-0000-4000-8000-000000000002', 'crm');
select public.commit_message_revoke('b6000005-0000-4000-8000-000000000003', 'b6000003-0000-4000-8000-000000000002', 'crm');
select public.commit_message_reaction('b6000005-0000-4000-8000-000000000001', 'b6000003-0000-4000-8000-000000000002', '👍');
select public.ingest_whatsapp_reaction('rm_instance', 'rm-crm-1', '5582988886001@s.whatsapp.net', false, '❤️');
reset role;
update public.messages set forwarded = true where id = 'b6000005-0000-4000-8000-000000000001';

-- ─── Mensagens ───────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6000000-0000-4000-8000-000000000003';
create temp table rm_msgs on commit drop as
select m as msg from jsonb_array_elements(public.get_conversation_messages((select id from rm_c where n = 1), null, null, 50)->'messages') as m;
grant select on rm_msgs to authenticated;
select is((select count(*)::int from rm_msgs), 3, 'a mensagem escondida NÃO aparece (cliente, resposta e apagada)');
select is((select count(*)::int from rm_msgs where msg->>'text_content' = 'Mensagem que será escondida'), 0, 'e o texto escondido não vaza');
select is((select msg->>'text_content' from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000001'), 'Resposta editada', 'texto editado aparece');
select ok((select msg->>'edited_at' is not null from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000001'), 'marca de editada');
select is((select msg->'reply_snapshot'->>'text' from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000001'), 'Oi 1', 'citação vem com o trecho');
select is((select (msg->>'forwarded')::boolean from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000001'), true, 'marca de encaminhada');
select is((select msg->>'internal_author_member_id' from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000001'), 'b6000003-0000-4000-8000-000000000002', 'autor interno para as permissões da tela');
select is((select jsonb_array_length(msg->'reactions') from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000001'), 2, 'duas reações (atendente e cliente)');
select is((select count(*)::int from rm_msgs, jsonb_array_elements(msg->'reactions') r where msg->>'id' = 'b6000005-0000-4000-8000-000000000001' and (r->>'mine')::boolean), 1, 'a reação do atendente é da nossa conta do WhatsApp: conta como "minha" (a do cliente, não)');
select is((select msg->>'text_content' from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000003'), null, 'mensagem apagada vem SEM texto');
select is((select jsonb_array_length(msg->'attachments') from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000003'), 0, 'e SEM arquivos');
select ok((select msg->>'deleted_at' is not null from rm_msgs where msg->>'id' = 'b6000005-0000-4000-8000-000000000003'), 'mas marcada como apagada');
set local "request.jwt.claim.sub" = 'b6000000-0000-4000-8000-000000000002';
select is((select count(*)::int from jsonb_array_elements(public.get_conversation_messages((select id from rm_c where n = 1), null, null, 50)->'messages') m, jsonb_array_elements(m->'reactions') r where (r->>'mine')::boolean), 1, 'a reação do próprio atendente vem marcada como "minha"');

-- ─── Lista: prévia, escondidas, apagadas, prazo ──────────────────────────────────────────────────
select is(
    (select i->>'last_msg_text' from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 50)->'items') i where i->>'conversation_id' = (select id::text from rm_c where n = 1)),
    'Resposta editada',
    'a prévia ignora a mensagem escondida (mais recente) e mostra a última visível'
);
reset role;
-- a última visível agora é apagada para todos
set local role service_role;
select public.commit_message_revoke('b6000005-0000-4000-8000-000000000001', 'b6000003-0000-4000-8000-000000000002', 'crm');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6000000-0000-4000-8000-000000000002';
select is(
    (select i->>'last_msg_text' from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 50)->'items') i where i->>'conversation_id' = (select id::text from rm_c where n = 1)),
    '🚫 Mensagem apagada',
    'apagada para todos: a prévia mostra "Mensagem apagada"'
);
select is(
    (select i->>'sla_direction' from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 50)->'items') i where i->>'conversation_id' = (select id::text from rm_c where n = 1)),
    'outgoing',
    'esconder/apagar NÃO muda o prazo (a última mensagem válida continua nossa)'
);
select is((public.get_conversation_item((select id from rm_c where n = 1))->>'last_msg_text'), '🚫 Mensagem apagada', 'o cabeçalho segue a mesma regra');

-- ─── Fixar ───────────────────────────────────────────────────────────────────────────────────────
select is((public.set_conversation_pin((select id from rm_c where n = 5), true)->>'status'), 'pinned', 'atendente fixa uma conversa');
select is((public.set_conversation_pin((select id from rm_c where n = 5), true)->>'status'), 'unchanged', 'fixar de novo não muda');
select is((public.get_conversations_inbox('all', null, null, null, 3)->'items'->0->>'conversation_id'), (select id::text from rm_c where n = 5), 'a fixada vem no TOPO da lista (mesmo sendo antiga)');
select is((public.get_conversations_inbox('all', null, null, null, 3)->'items'->0->>'is_pinned')::boolean, true, 'e marcada como fixada');
select is((public.get_conversation_item((select id from rm_c where n = 5))->>'is_pinned')::boolean, true, 'cabeçalho também sabe que está fixada');
select is(
    (select count(*)::int from jsonb_array_elements(public.get_conversations_inbox('all', null, now() - interval '3 hours', (select id from rm_c where n = 3), 50)->'items') i where i->>'conversation_id' = (select id::text from rm_c where n = 5)),
    0, 'páginas seguintes (com cursor) não repetem a fixada'
);
set local "request.jwt.claim.sub" = 'b6000000-0000-4000-8000-000000000003';
select is((public.get_conversations_inbox('all', null, null, null, 50)->'items'->0->>'is_pinned')::boolean, false, 'a fixação é PESSOAL: o atendente 2 não vê a conversa fixada pelo atendente 1');
select is((select count(*)::int from public.conversation_pins), 0, 'e não lê as fixações dos outros');
set local "request.jwt.claim.sub" = 'b6000000-0000-4000-8000-000000000002';
select lives_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_c where n = 1)), 'segunda fixação');
select lives_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_c where n = 2)), 'terceira');
select lives_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_c where n = 3)), 'quarta');
select lives_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_c where n = 4)), 'quinta');
select throws_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_c where n = 6)), '22023', 'pin_limit_reached', 'a sexta fixação é recusada (limite de 5 por pessoa)');
select throws_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_prot)), '42501', 'pin_not_authorized', 'não fixa conversa que não enxerga');
select is((public.set_conversation_pin((select id from rm_c where n = 4), false)->>'status'), 'unpinned', 'desafixar libera uma vaga');
select lives_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_c where n = 6)), 'e agora cabe outra');
set local "request.jwt.claim.sub" = 'b6000000-0000-4000-8000-000000000004';
select throws_ok(format($$select public.set_conversation_pin(%L, true)$$, (select id from rm_c where n = 1)), '42704', 'conversation_not_available', 'owner de outro workspace não fixa conversa alheia');
reset role;
set local role anon;
select throws_ok($$select public.set_conversation_pin(gen_random_uuid(), true)$$, '42501', null, 'anon não fixa');
reset role;

select * from finish();
rollback;
