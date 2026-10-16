begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(20);

insert into auth.users (id, email)
values
    ('b6300000-0000-4000-8000-000000000001', 'to-owner@example.test'),
    ('b6300000-0000-4000-8000-000000000002', 'to-att1@example.test'),
    ('b6300000-0000-4000-8000-000000000003', 'to-att2@example.test'),
    ('b6300000-0000-4000-8000-000000000004', 'to-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b6300001-0000-4000-8000-000000000001', 'b6300000-0000-4000-8000-000000000001', 'TO Owner', 'active'),
    ('b6300001-0000-4000-8000-000000000002', 'b6300000-0000-4000-8000-000000000002', 'TO Att1', 'active'),
    ('b6300001-0000-4000-8000-000000000003', 'b6300000-0000-4000-8000-000000000003', 'TO Att2', 'active'),
    ('b6300001-0000-4000-8000-000000000004', 'b6300000-0000-4000-8000-000000000004', 'TO Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b6300002-0000-4000-8000-000000000001', 'TO Workspace A', 'active', 'America/Maceio'),
    ('b6300002-0000-4000-8000-000000000002', 'TO Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b6300003-0000-4000-8000-000000000001', 'b6300002-0000-4000-8000-000000000001', 'b6300001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b6300003-0000-4000-8000-000000000002', 'b6300002-0000-4000-8000-000000000001', 'b6300001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b6300003-0000-4000-8000-000000000001'),
    ('b6300003-0000-4000-8000-000000000003', 'b6300002-0000-4000-8000-000000000001', 'b6300001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b6300003-0000-4000-8000-000000000001'),
    ('b6300003-0000-4000-8000-000000000004', 'b6300002-0000-4000-8000-000000000002', 'b6300001-0000-4000-8000-000000000004', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values
    ('b6300004-0000-4000-8000-000000000001', 'b6300002-0000-4000-8000-000000000001', 'whatsapp', 'to_instance', '+5582999906300', 'active', now(), true),
    ('b6300004-0000-4000-8000-000000000002', 'b6300002-0000-4000-8000-000000000002', 'whatsapp', 'to_instance_b', '+5582999906301', 'active', now(), true);

-- c1: cliente esperando (sem responsável); c2: atribuída a att1; c3: a equipe respondeu; c4: contato protegido; B: outro workspace
select public.ingest_whatsapp_text_message('to_instance', 'to-1', '5582988886301@s.whatsapp.net', false, 'Cliente Um', 'Oi, c1', now() - interval '30 minutes');
select public.ingest_whatsapp_text_message('to_instance', 'to-2', '5582988886302@s.whatsapp.net', false, 'Cliente Dois', 'Oi, c2', now() - interval '20 minutes');
select public.ingest_whatsapp_text_message('to_instance', 'to-3', '5582988886303@s.whatsapp.net', false, 'Cliente Tres', 'Oi, c3', now() - interval '10 minutes');
select public.ingest_whatsapp_text_message('to_instance', 'to-4', '5582988886304@s.whatsapp.net', false, 'Cliente Protegido', 'Oi, c4', now() - interval '5 minutes');
select public.ingest_whatsapp_text_message('to_instance_b', 'to-b', '5582988886399@s.whatsapp.net', false, 'Cliente B', 'Oi, B', now() - interval '5 minutes');
update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988886304');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988886304';

create temp table to_c on commit drop as
select
    (select id from public.conversations where external_thread_id = '5582988886301@s.whatsapp.net') as c1,
    (select id from public.conversations where external_thread_id = '5582988886302@s.whatsapp.net') as c2,
    (select id from public.conversations where external_thread_id = '5582988886303@s.whatsapp.net') as c3,
    (select id from public.conversations where external_thread_id = '5582988886304@s.whatsapp.net') as c4;
grant select on to_c to authenticated;

insert into public.conversation_assignments (workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
select 'b6300002-0000-4000-8000-000000000001', c2, 'b6300003-0000-4000-8000-000000000002', 'b6300003-0000-4000-8000-000000000001', now() from to_c;
-- c3: a equipe respondeu
insert into public.messages (workspace_id, channel_connection_id, conversation_id, external_message_id, client_idempotency_key, direction, origin, internal_author_member_id, text_content, status, occurred_at)
select c.workspace_id, c.channel_connection_id, c.id, 'to-out-3', gen_random_uuid(), 'outgoing', 'crm', 'b6300003-0000-4000-8000-000000000001', 'Respondido', 'sent', now() - interval '2 minutes'
from public.conversations c where c.id = (select c3 from to_c);
-- uma mensagem escondida do cliente em c1 não conta como "recebida hoje"
insert into public.messages (workspace_id, channel_connection_id, conversation_id, external_message_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_created_at, received_at, hidden_at, hidden_by_member_id)
select m.workspace_id, m.channel_connection_id, m.conversation_id, 'to-hidden', 'incoming', 'whatsapp', m.sender_contact_point_id, 'escondida', 'received', now() - interval '25 minutes', now(), now(), now(), 'b6300003-0000-4000-8000-000000000001'
from public.messages m where m.external_message_id = 'to-1';

-- ─── Dono ────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6300000-0000-4000-8000-000000000001';
create temp table to_owner on commit drop as select public.get_today_overview() as r;
grant select on to_owner to authenticated;

select is((select jsonb_array_length(r->'conversations') from to_owner), 4, 'o dono vê as 4 conversas com prazo do workspace (e nenhuma do outro)');
select is((select count(*)::int from to_owner, jsonb_array_elements(r->'conversations') c where c->>'conversation_id' = (select c4::text from to_c)), 1, 'o dono vê também a do contato protegido');
select is((select r->>'timezone' from to_owner), 'America/Maceio', 'devolve o fuso do workspace');
select ok((select (r->>'day_start')::timestamptz <= now() from to_owner), 'o início do dia é anterior a agora');
select is((select c->>'has_outgoing' from to_owner, jsonb_array_elements(r->'conversations') c where c->>'conversation_id' = (select c3::text from to_c)), 'true', 'c3 já foi respondida pela equipe');
select is((select c->>'has_outgoing' from to_owner, jsonb_array_elements(r->'conversations') c where c->>'conversation_id' = (select c1::text from to_c)), 'false', 'c1 nunca foi respondida');
select is((select jsonb_array_length(c->'assignees') from to_owner, jsonb_array_elements(r->'conversations') c where c->>'conversation_id' = (select c1::text from to_c)), 0, 'c1 está sem responsável');
select is((select c->'assignees'->0->>'display_name' from to_owner, jsonb_array_elements(r->'conversations') c where c->>'conversation_id' = (select c2::text from to_c)), 'TO Att1', 'c2 mostra o responsável');
select is((select (r->'counters'->>'incoming_today')::int from to_owner), 4, 'recebidas hoje: 4 (a escondida não conta)');
select is((select (r->'counters'->>'outgoing_today')::int from to_owner), 1, 'enviadas hoje pelo CRM: 1');
select is((select (r->'counters'->>'new_conversations_today')::int from to_owner), 4, 'conversas novas hoje: 4');
select is((select (r->'counters'->>'tasks_completed_today')::int from to_owner), 0, 'nenhuma tarefa concluída hoje');

-- ─── Atendente ───────────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6300000-0000-4000-8000-000000000003';
create temp table to_att on commit drop as select public.get_today_overview() as r;
grant select on to_att to authenticated;
select is((select jsonb_array_length(r->'conversations') from to_att), 3, 'o atendente NÃO vê a conversa do contato protegido (RLS)');
select is((select (r->'counters'->>'incoming_today')::int from to_att), 3, 'os contadores também respeitam a RLS');
select is((select c->>'assigned_to_me' from to_att, jsonb_array_elements(r->'conversations') c where c->>'conversation_id' = (select c2::text from to_c)), 'false', 'att2 não é o responsável de c2');

set local "request.jwt.claim.sub" = 'b6300000-0000-4000-8000-000000000002';
select is((select c->>'assigned_to_me' from jsonb_array_elements(public.get_today_overview()->'conversations') c where c->>'conversation_id' = (select c2::text from to_c)), 'true', 'att1 é o responsável de c2');

-- ─── Outro workspace, anônimo e propriedades ─────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6300000-0000-4000-8000-000000000004';
select is((select jsonb_array_length(public.get_today_overview()->'conversations')), 1, 'o dono de outro workspace vê só o dele');
reset role;
select ok(not has_function_privilege('anon', 'public.get_today_overview(integer)', 'execute'), 'anon não executa');
select ok(
    not has_function_privilege('service_role', 'public.get_today_overview(integer)', 'execute')
    and has_function_privilege('authenticated', 'public.get_today_overview(integer)', 'execute'),
    'só o usuário logado executa (service_role não: depende de auth.uid())'
);
select ok(
    (select not p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig)
     from pg_proc p where p.oid = 'public.get_today_overview(integer)'::regprocedure),
    'função de leitura: INVOKER, STABLE e search_path vazio'
);

select * from finish();
rollback;
