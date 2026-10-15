begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(13);

insert into auth.users (id, email) values ('b5600000-0000-4000-8000-000000000001', 'se-owner@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values ('b5600001-0000-4000-8000-000000000001', 'b5600000-0000-4000-8000-000000000001', 'SE Owner', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5600002-0000-4000-8000-000000000001', 'SE Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values ('b5600003-0000-4000-8000-000000000001', 'b5600002-0000-4000-8000-000000000001', 'b5600001-0000-4000-8000-000000000001', 'owner', 'active', now(), null);
-- Conexão pessoal: só contatos cadastrados LIGADO
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups, ingest_only_known_contacts)
values ('b5600004-0000-4000-8000-000000000001', 'b5600002-0000-4000-8000-000000000001', 'whatsapp', 'se_instance', '+5582999905600', 'active', now(), false, true);

-- Mensagem minha para o meu próprio número ("Mensagens para você")
create temp table se_res (k text primary key, r jsonb);
insert into se_res select 'self1', public.ingest_whatsapp_text_message('se_instance', 'se-1', '5582999905600@s.whatsapp.net', true, '', 'anotação para mim', now() - interval '5 minutes');
select is((select r->>'status' from se_res where k = 'self1'), 'success', 'modo "só cadastrados": a conversa consigo mesmo entra (o próprio número conta como conhecido)');
select is((select count(*)::int from public.conversations where external_thread_id = '5582999905600@s.whatsapp.net'), 1, 'uma conversa criada');
select is((select count(*)::int from public.messages where external_message_id = 'se-1'), 1, 'a mensagem entra UMA vez');
select is((select count(*)::int from public.contacts where display_name = 'Mensagens para você'), 1, 'cria um único contato "Mensagens para você"');

-- Mesmo id externo (eco/reenvio): duplicado, sem segunda linha
insert into se_res select 'dup', public.ingest_whatsapp_text_message('se_instance', 'se-1', '5582999905600@s.whatsapp.net', true, '', 'anotação para mim', now() - interval '5 minutes');
select is((select r->>'status' from se_res where k = 'dup'), 'duplicate', 'mesmo id externo: duplicado');
select is((select count(*)::int from public.messages where external_message_id = 'se-1'), 1, 'continua uma linha só');

-- Outra mensagem: mesma conversa, sem novo contato
select public.ingest_whatsapp_text_message('se_instance', 'se-2', '5582999905600@s.whatsapp.net', true, '', 'segunda anotação', now() - interval '2 minutes');
select is((select count(*)::int from public.conversations where external_thread_id = '5582999905600@s.whatsapp.net'), 1, 'mensagens seguintes ficam na mesma conversa');
select is((select count(*)::int from public.contacts where display_name = 'Mensagens para você'), 1, 'e não criam outro contato');
select is((select count(*)::int from public.messages m join public.conversations c on c.id = m.conversation_id where c.external_thread_id = '5582999905600@s.whatsapp.net'), 2, 'duas mensagens na conversa consigo mesmo');

-- Qualquer OUTRO número desconhecido continua ignorado no modo "só cadastrados"
insert into se_res select 'other', public.ingest_whatsapp_text_message('se_instance', 'se-3', '5582988885600@s.whatsapp.net', false, 'Desconhecido', 'Oi', now());
select is((select r->>'reason' from se_res where k = 'other'), 'unknown_contact', 'outro número desconhecido segue ignorado');
select is((select count(*)::int from public.contacts), 1, 'nenhum contato novo além do próprio número');

-- Nunca tem prazo
select is(private.is_self_conversation((select id from public.conversations where external_thread_id = '5582999905600@s.whatsapp.net')), true, 'é reconhecida como conversa consigo mesmo');
select is(private.sla_applies((select id from public.conversations where external_thread_id = '5582999905600@s.whatsapp.net')), false, 'e nunca tem prazo');

select * from finish();
rollback;
