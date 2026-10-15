begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(18);

insert into auth.users (id, email)
values
    ('b5700000-0000-4000-8000-000000000001', 'gv-owner@example.test'),
    ('b5700000-0000-4000-8000-000000000002', 'gv-att@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5700001-0000-4000-8000-000000000001', 'b5700000-0000-4000-8000-000000000001', 'GV Owner', 'active'),
    ('b5700001-0000-4000-8000-000000000002', 'b5700000-0000-4000-8000-000000000002', 'GV Att', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5700002-0000-4000-8000-000000000001', 'GV Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5700003-0000-4000-8000-000000000001', 'b5700002-0000-4000-8000-000000000001', 'b5700001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5700003-0000-4000-8000-000000000002', 'b5700002-0000-4000-8000-000000000001', 'b5700001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5700003-0000-4000-8000-000000000001');
-- Padrão de produção: leitura de grupos DESLIGADA
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5700004-0000-4000-8000-000000000001', 'b5700002-0000-4000-8000-000000000001', 'whatsapp', 'gv_instance', '+5582999905700', 'active', now());

select is((select ingest_groups from public.channel_connections where id = 'b5700004-0000-4000-8000-000000000001'), false, 'a leitura de grupos nasce DESLIGADA');
select is(public.ingest_whatsapp_group_text_message('gv_instance', 'gv-0', '120363005700000001@g.us', '5582988885700@s.whatsapp.net', false, 'Grupo GV', 'Membro', 'não pode entrar', now())->>'status', 'ignored', 'com a leitura desligada a mensagem de grupo é ignorada');
select is((select count(*)::int from public.conversations where conversation_type = 'group' and workspace_id = 'b5700002-0000-4000-8000-000000000001'), 0, 'e nenhuma conversa de grupo é criada');

update public.channel_connections set ingest_groups = true where id = 'b5700004-0000-4000-8000-000000000001';
-- Grupo A: mensagem ANTES da liberação; Grupo B continua restrito
select public.ingest_whatsapp_group_text_message('gv_instance', 'gv-a-1', '120363005700000001@g.us', '5582988885700@s.whatsapp.net', false, 'Grupo A', 'Membro Comum', 'mensagem ANTES', now() - interval '2 hours');
select public.ingest_whatsapp_group_text_message('gv_instance', 'gv-b-1', '120363005700000002@g.us', '5582988885700@s.whatsapp.net', false, 'Grupo B', 'Membro Comum', 'mensagem do grupo B', now() - interval '1 hour');

create temp table gv_ids on commit drop as
select
    (select id from public.conversations where external_thread_id = '120363005700000001@g.us') as ga,
    (select id from public.conversations where external_thread_id = '120363005700000002@g.us') as gb;
grant select on gv_ids to authenticated;

select is((select visibility from public.conversations where id = (select ga from gv_ids)), 'owner_only', 'grupo novo nasce restrito ao dono');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select is((select count(*)::int from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') i where i->>'conversation_type' = 'group'), 2, 'dono vê TODOS os grupos na lista "Tudo"');
select is((public.get_conversations_inbox('groups', null, null, null, 100)->'counts'->>'groups')::int, 2, 'e o chip Grupos conta os dois');

set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000002';
select is((select count(*)::int from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') i where i->>'conversation_type' = 'group'), 0, 'atendente NÃO vê grupo restrito');
select is((select count(*)::int from public.messages where conversation_id = (select ga from gv_ids)), 0, 'atendente não lê mensagens de grupo restrito');
select throws_ok(format($$select public.set_group_team_visibility(%L, true)$$, (select ga from gv_ids)), '42501', 'group_visibility_not_authorized', 'atendente não libera grupo');

-- Dono libera o grupo A
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select is((public.set_group_team_visibility((select ga from gv_ids), true)->>'team_visible')::boolean, true, 'dono libera o grupo A para a equipe');
reset role;
select is((select count(*)::int from public.audit_events where action = 'group.team_visibility_enabled' and target_id = (select ga from gv_ids)), 1, 'a liberação foi auditada');

-- Depois da liberação: mensagem de membro comum e de membro PROTEGIDO
select public.ingest_whatsapp_group_text_message('gv_instance', 'gv-a-2', '120363005700000001@g.us', '5582988885700@s.whatsapp.net', false, 'Membro Comum', 'Membro', 'mensagem DEPOIS comum', clock_timestamp() + interval '1 minute');
select public.ingest_whatsapp_group_text_message('gv_instance', 'gv-a-3', '120363005700000001@g.us', '5582988885701@s.whatsapp.net', false, 'Membro Protegido', 'Membro', 'mensagem DEPOIS protegida', clock_timestamp() + interval '2 minutes');
update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988885701');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988885701';

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000002';
select is((select count(*)::int from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') i where i->>'conversation_type' = 'group'), 1, 'atendente vê só o grupo liberado');
select is((select string_agg(text_content, '|' order by occurred_at) from public.messages where conversation_id = (select ga from gv_ids)), 'mensagem DEPOIS comum', 'e só a mensagem posterior à liberação, sem a de contato protegido');
select is((select count(*)::int from public.messages where conversation_id = (select gb from gv_ids)), 0, 'o grupo B segue restrito');
select is((select count(*)::int from public.messages where text_content = 'mensagem ANTES'), 0, 'nada retroativo: o que veio antes da liberação continua oculto');

-- Dono restringe de novo
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select is((public.set_group_team_visibility((select ga from gv_ids), false)->>'team_visible')::boolean, false, 'dono restringe o grupo de novo');
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000002';
select is((select count(*)::int from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') i where i->>'conversation_type' = 'group'), 0, 'atendente perde o acesso ao grupo restringido');
-- Grupo nunca tem prazo
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select is(private.sla_applies((select ga from gv_ids)), false, 'grupo nunca tem prazo (regra única)');
reset role;

select * from finish();
rollback;
