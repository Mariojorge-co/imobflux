begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(41);

-- Avisos de mensagem nova com o app fechado (Web Push): RLS das assinaturas e a seleção de destinatários no servidor.

-- ─── Fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
    ('b6800000-0000-4000-8000-000000000001', 'wp-owner@example.test'),
    ('b6800000-0000-4000-8000-000000000002', 'wp-a@example.test'),
    ('b6800000-0000-4000-8000-000000000003', 'wp-b@example.test'),
    ('b6800000-0000-4000-8000-000000000004', 'wp-s@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b6800001-0000-4000-8000-000000000001', 'b6800000-0000-4000-8000-000000000001', 'WP Owner', 'active'),
    ('b6800001-0000-4000-8000-000000000002', 'b6800000-0000-4000-8000-000000000002', 'WP Atendente A', 'active'),
    ('b6800001-0000-4000-8000-000000000003', 'b6800000-0000-4000-8000-000000000003', 'WP Atendente B', 'active'),
    ('b6800001-0000-4000-8000-000000000004', 'b6800000-0000-4000-8000-000000000004', 'WP Suspenso', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b6800002-0000-4000-8000-000000000001', 'WP Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, suspended_at, invited_by_member_id)
values
    ('b6800003-0000-4000-8000-000000000001', 'b6800002-0000-4000-8000-000000000001', 'b6800001-0000-4000-8000-000000000001', 'owner', 'active', now(), null, null),
    ('b6800003-0000-4000-8000-000000000002', 'b6800002-0000-4000-8000-000000000001', 'b6800001-0000-4000-8000-000000000002', 'attendant', 'active', now(), null, 'b6800003-0000-4000-8000-000000000001'),
    ('b6800003-0000-4000-8000-000000000003', 'b6800002-0000-4000-8000-000000000001', 'b6800001-0000-4000-8000-000000000003', 'attendant', 'active', now(), null, 'b6800003-0000-4000-8000-000000000001'),
    ('b6800003-0000-4000-8000-000000000004', 'b6800002-0000-4000-8000-000000000001', 'b6800001-0000-4000-8000-000000000004', 'attendant', 'active', now(), null, 'b6800003-0000-4000-8000-000000000001');
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b6800004-0000-4000-8000-000000000001', 'b6800002-0000-4000-8000-000000000001', 'whatsapp', 'wp_instance', '+5582999906800', 'active', now());
update public.channel_connections set ingest_groups = true;

-- Contato protegido (conversa privada: só o dono enxerga)
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b6800005-0000-4000-8000-000000000002', 'b6800002-0000-4000-8000-000000000001', 'WP Protegido', 'lead', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b6800006-0000-4000-8000-000000000002', 'b6800002-0000-4000-8000-000000000001', 'b6800005-0000-4000-8000-000000000002', 'phone', '+5582977006800', '(82) 97700-6800', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');

create temp table wp_msg (k text primary key, id uuid, conv uuid);
grant all on wp_msg to public;
insert into wp_msg
select 'c1', (r->>'message_id')::uuid, (select id from public.conversations where external_thread_id = '5582988886800@s.whatsapp.net')
from (select public.ingest_whatsapp_text_message('wp_instance', 'wp-c1', '5582988886800@s.whatsapp.net', false, 'Cliente WP', 'Olá', now()) as r) as x;
insert into wp_msg
select 'priv', (r->>'message_id')::uuid, (select id from public.conversations where external_thread_id = '5582977006800@s.whatsapp.net')
from (select public.ingest_whatsapp_text_message('wp_instance', 'wp-priv', '5582977006800@s.whatsapp.net', false, 'Protegido', 'Sigilo', now()) as r) as x;
insert into wp_msg
select 'grp', (r->>'message_id')::uuid, (select id from public.conversations where external_thread_id = '120363006800000001@g.us')
from (select public.ingest_whatsapp_group_text_message('wp_instance', 'wp-grp', '120363006800000001@g.us', '5582988886801@s.whatsapp.net', false, 'Grupo WP', 'Membro', 'Oi grupo', now()) as r) as x;
-- conversa do número com ele mesmo: a mensagem é gravada como recebida de propósito para provar que a regra da conversa a barra
insert into wp_msg
select 'self', (r->>'message_id')::uuid, (select id from public.conversations where external_thread_id = '5582999906800@s.whatsapp.net')
from (select public.ingest_whatsapp_text_message('wp_instance', 'wp-self', '5582999906800@s.whatsapp.net', true, '', 'anotação', now()) as r) as x;
update public.messages
   set direction = 'incoming', origin = 'whatsapp', status = 'received',
       sender_contact_point_id = (select point.id from public.contact_points as point where point.normalized_value like '%82999906800' limit 1)
 where id = (select id from wp_msg where k = 'self');
-- mensagem enviada pelo celular da equipe, na conversa do cliente
insert into wp_msg
select 'out', (r->>'message_id')::uuid, (select id from public.conversations where external_thread_id = '5582988886800@s.whatsapp.net')
from (select public.ingest_whatsapp_text_message('wp_instance', 'wp-out', '5582988886800@s.whatsapp.net', true, 'Cliente WP', 'Resposta', now()) as r) as x;
-- a conversa de cada mensagem (a subconsulta do insert não enxerga o que a própria ingestão gravou)
update wp_msg set conv = (select message.conversation_id from public.messages as message where message.id = wp_msg.id);

-- Uma assinatura por pessoa (o teste da RLS também usa estas linhas)
insert into public.push_subscriptions (id, workspace_id, member_id, endpoint, p256dh, auth, platform)
values
    ('b6800007-0000-4000-8000-000000000001', 'b6800002-0000-4000-8000-000000000001', 'b6800003-0000-4000-8000-000000000001', 'https://push.example.test/owner-0000000001', 'p256dh-owner-key-0001', 'auth-owner-1', 'desktop'),
    ('b6800007-0000-4000-8000-000000000002', 'b6800002-0000-4000-8000-000000000001', 'b6800003-0000-4000-8000-000000000002', 'https://push.example.test/atend-a-0000000002', 'p256dh-atend-a-key-02', 'auth-a-2', 'android'),
    ('b6800007-0000-4000-8000-000000000003', 'b6800002-0000-4000-8000-000000000001', 'b6800003-0000-4000-8000-000000000003', 'https://push.example.test/atend-b-0000000003', 'p256dh-atend-b-key-03', 'auth-b-3', 'ios'),
    ('b6800007-0000-4000-8000-000000000004', 'b6800002-0000-4000-8000-000000000001', 'b6800003-0000-4000-8000-000000000004', 'https://push.example.test/suspenso-0000000004', 'p256dh-suspenso-key-04', 'auth-s-4', 'android');

-- Quem recebe, como lista ordenada de rótulos (o...: dono, a: A, b: B, s: suspenso)
create function pg_temp.who(p_message uuid) returns text
language sql stable as $$
    select coalesce(string_agg(case target.member_id
        when 'b6800003-0000-4000-8000-000000000001' then 'dono'
        when 'b6800003-0000-4000-8000-000000000002' then 'A'
        when 'b6800003-0000-4000-8000-000000000003' then 'B'
        when 'b6800003-0000-4000-8000-000000000004' then 'S' end, ',' order by target.member_id), '-')
    from public.get_push_targets(p_message) as target;
$$;
grant execute on function pg_temp.who(uuid) to public;

-- ─── Permissões das funções ──────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('service_role', 'public.get_push_targets(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('authenticated', 'public.get_push_targets(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.get_push_targets(uuid)', 'execute'),
    'get_push_targets é só do servidor (service_role); nem authenticated nem anon executam'
);
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.register_push_subscription(text,text,text,text,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.register_push_subscription(text,text,text,text,text)', 'execute'),
    'register_push_subscription é para authenticated e nunca para anon'
);

-- ─── Destinatários ───────────────────────────────────────────────────────────────────────────
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'dono', 'conversa SEM responsável: só o dono');

insert into public.conversation_assignments (workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
values ('b6800002-0000-4000-8000-000000000001', (select conv from wp_msg where k = 'c1'), 'b6800003-0000-4000-8000-000000000002', 'b6800003-0000-4000-8000-000000000001', now());
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A', 'com responsável: só o responsável (o dono não recebe)');

insert into public.conversation_assignments (workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
values ('b6800002-0000-4000-8000-000000000001', (select conv from wp_msg where k = 'c1'), 'b6800003-0000-4000-8000-000000000003', 'b6800003-0000-4000-8000-000000000001', now());
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A,B', 'mais de um responsável: todos recebem');

insert into public.conversation_assignments (workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
values ('b6800002-0000-4000-8000-000000000001', (select conv from wp_msg where k = 'c1'), 'b6800003-0000-4000-8000-000000000001', 'b6800003-0000-4000-8000-000000000001', now());
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'dono,A,B', 'o dono responsável também recebe');
delete from public.conversation_assignments where member_id = 'b6800003-0000-4000-8000-000000000001' and conversation_id = (select conv from wp_msg where k = 'c1');

-- Responsável suspenso não recebe; se só restar ele, cai no dono
update public.workspace_members set status = 'suspended', suspended_at = now() where id = 'b6800003-0000-4000-8000-000000000003';
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A', 'membro suspenso não recebe');
update public.workspace_members set status = 'suspended', suspended_at = now() where id = 'b6800003-0000-4000-8000-000000000002';
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'dono', 'sem nenhum responsável ativo: volta ao dono');
update public.workspace_members set status = 'active', suspended_at = null where id in ('b6800003-0000-4000-8000-000000000002', 'b6800003-0000-4000-8000-000000000003');
update public.app_users set status = 'inactive', deactivated_at = now() where id = 'b6800001-0000-4000-8000-000000000002';
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'B', 'usuário inativo não recebe');
update public.app_users set status = 'active', deactivated_at = null where id = 'b6800001-0000-4000-8000-000000000002';
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A,B', 'reativados voltam a receber');

-- Conversa privada (contato protegido): só o dono, e só quando é dele
select is(pg_temp.who((select id from wp_msg where k = 'priv')), 'dono', 'conversa privada sem responsável: só o dono, atendente nunca');
insert into public.conversation_assignments (workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
values ('b6800002-0000-4000-8000-000000000001', (select conv from wp_msg where k = 'priv'), 'b6800003-0000-4000-8000-000000000002', 'b6800003-0000-4000-8000-000000000001', now());
select is(pg_temp.who((select id from wp_msg where k = 'priv')), '-', 'atendente atribuído a conversa que não enxerga não recebe (e o dono também não: há responsável)');
delete from public.conversation_assignments where conversation_id = (select conv from wp_msg where k = 'priv');

-- Conversa do número com ele mesmo
select is(pg_temp.who((select id from wp_msg where k = 'self')), '-', 'conversa do número com ele mesmo: ninguém recebe');

-- Grupo
select is(pg_temp.who((select id from wp_msg where k = 'grp')), '-', 'grupo não liberado (owner_only): ninguém recebe');
update public.conversations set visibility = 'commercial', commercial_visible_from = started_at where id = (select conv from wp_msg where k = 'grp');
select is(pg_temp.who((select id from wp_msg where k = 'grp')), 'dono', 'grupo liberado sem responsável: só o dono');
select is((select contact_name from public.get_push_targets((select id from wp_msg where k = 'grp')) limit 1), 'Grupo WP', 'no grupo o nome do aviso é o nome do grupo');
select is((select contact_name from public.get_push_targets((select id from wp_msg where k = 'c1')) limit 1), 'Cliente WP', 'na conversa individual o nome do aviso é o do contato');

-- Arquivada, mensagem da equipe, histórico, apagada
update public.conversations set operational_status = 'archived', archived_at = now() where id = (select conv from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'c1')), '-', 'conversa arquivada: ninguém recebe');
update public.conversations set operational_status = 'active', archived_at = null where id = (select conv from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A,B', 'desarquivada volta a avisar');

update public.messages set origin = 'whatsapp' where id = (select id from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'out')), '-', 'mensagem de saída (celular da equipe): ninguém recebe');
update public.messages set is_history = true where id = (select id from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'c1')), '-', 'mensagem de histórico: ninguém recebe');
update public.messages set is_history = false, hidden_at = now(), hidden_by_member_id = 'b6800003-0000-4000-8000-000000000001' where id = (select id from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'c1')), '-', 'mensagem escondida: ninguém recebe');
update public.messages set hidden_at = null, hidden_by_member_id = null where id = (select id from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A,B', 'mensagem nova de cliente: avisa de novo');

-- Prazo pausado avisa; desativado só com a opção ligada (padrão desligado)
update public.conversations set sla_mode = 'paused', sla_paused_at = now() where id = (select conv from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A,B', 'prazo pausado: avisa');
update public.conversations set sla_mode = 'disabled', sla_paused_at = null where id = (select conv from wp_msg where k = 'c1');
select is(pg_temp.who((select id from wp_msg where k = 'c1')), '-', 'prazo desativado: em silêncio por padrão');
update public.push_subscriptions set include_sla_disabled = true where id = 'b6800007-0000-4000-8000-000000000002';
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A', 'prazo desativado: avisa só quem ligou a opção');
update public.conversations set sla_mode = 'active' where id = (select conv from wp_msg where k = 'c1');

-- Assinatura desativada não recebe; mensagem inexistente não devolve nada
update public.push_subscriptions set disabled_at = now() where id = 'b6800007-0000-4000-8000-000000000003';
select is(pg_temp.who((select id from wp_msg where k = 'c1')), 'A', 'assinatura desativada (410): não recebe');
select is(pg_temp.who('00000000-0000-4000-8000-000000000000'), '-', 'mensagem inexistente: nada');

-- O texto da mensagem nunca é devolvido
select ok(
    pg_get_functiondef('public.get_push_targets(uuid)'::regprocedure) not ilike '%text_content%',
    'a função de destinatários nunca lê o texto da mensagem'
);

-- ─── RLS das assinaturas ───────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6800000-0000-4000-8000-000000000002';

select is((select count(*)::int from public.push_subscriptions), 1, 'atendente A só enxerga a própria assinatura');
select is((select platform from public.push_subscriptions), 'android', 'e é a dele');
select throws_ok(
    $$insert into public.push_subscriptions (workspace_id, member_id, endpoint, p256dh, auth, platform)
      values ('b6800002-0000-4000-8000-000000000001', 'b6800003-0000-4000-8000-000000000003', 'https://push.example.test/forjada-00000000009', 'p256dh-forjada-key-09', 'auth-9', 'android')$$,
    '42501',
    null,
    'atendente A não cria assinatura em nome do B'
);
delete from public.push_subscriptions where member_id = 'b6800003-0000-4000-8000-000000000001';
reset role;
select is((select count(*)::int from public.push_subscriptions where member_id = 'b6800003-0000-4000-8000-000000000001'), 1, 'atendente A não apaga a assinatura do dono (0 linhas afetadas)');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b6800000-0000-4000-8000-000000000002';
select is((select public.register_push_subscription('https://push.example.test/novo-aparelho-a-0001', 'p256dh-novo-a-key-001', 'auth-novo-a', 'Mozilla/5.0 teste', 'ios')->>'status'), 'registered', 'registrar o aparelho da pessoa logada');
select is((select count(*)::int from public.push_subscriptions), 2, 'agora A tem dois aparelhos');
select is((select public.register_push_subscription('https://push.example.test/novo-aparelho-a-0001', 'p256dh-novo-a-key-002', 'auth-novo-a2', 'Mozilla/5.0 teste', 'ios')->>'status'), 'registered', 'registrar de novo é idempotente');
select is((select count(*)::int from public.push_subscriptions), 2, 'sem duplicar o aparelho');
select is((select public.register_push_subscription('http://inseguro.example.test/x', 'p', 'a', 'ua', 'ios')->>'status'), 'invalid_endpoint', 'endpoint que não é https é recusado');

-- O mesmo aparelho entra com outra pessoa: a linha passa a ser dela
set local "request.jwt.claim.sub" = 'b6800000-0000-4000-8000-000000000001';
select is((select public.register_push_subscription('https://push.example.test/novo-aparelho-a-0001', 'p256dh-novo-a-key-003', 'auth-novo-a3', 'Mozilla/5.0 teste', 'ios')->>'status'), 'registered', 'o dono entra no mesmo aparelho');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://push.example.test/novo-aparelho-a-0001'), 1, 'continua uma linha por aparelho');
reset role;
select is((select member_id::text from public.push_subscriptions where endpoint = 'https://push.example.test/novo-aparelho-a-0001'), 'b6800003-0000-4000-8000-000000000001', 'e agora é do dono (a pessoa anterior perde o aparelho)');

select * from finish();
rollback;
