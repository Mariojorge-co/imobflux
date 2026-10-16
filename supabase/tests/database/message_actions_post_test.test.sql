begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(26);

insert into auth.users (id, email)
values
    ('b6300000-0000-4000-8000-000000000001', 'pt-owner@example.test'),
    ('b6300000-0000-4000-8000-000000000002', 'pt-att@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b6300001-0000-4000-8000-000000000001', 'b6300000-0000-4000-8000-000000000001', 'PT Owner', 'active'),
    ('b6300001-0000-4000-8000-000000000002', 'b6300000-0000-4000-8000-000000000002', 'PT Att', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b6300002-0000-4000-8000-000000000001', 'PT Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b6300003-0000-4000-8000-000000000001', 'b6300002-0000-4000-8000-000000000001', 'b6300001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b6300003-0000-4000-8000-000000000002', 'b6300002-0000-4000-8000-000000000001', 'b6300001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b6300003-0000-4000-8000-000000000001');
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b6300004-0000-4000-8000-000000000001', 'b6300002-0000-4000-8000-000000000001', 'whatsapp', 'pt_instance', '+5582999906300', 'active', now(), true);

-- m1: mensagem nossa (enviada pelo celular da conta, direction outgoing); m2: do cliente
select public.ingest_whatsapp_text_message('pt_instance', 'pt-1', '5582988886301@s.whatsapp.net', true, 'Cliente PT', 'Texto original', now() - interval '2 minutes');
select public.ingest_whatsapp_text_message('pt_instance', 'pt-2', '5582988886301@s.whatsapp.net', false, 'Cliente PT', 'Mensagem do cliente', now() - interval '1 minute');
select public.ingest_whatsapp_text_message('pt_instance', 'pt-3', '5582988886301@s.whatsapp.net', true, 'Cliente PT', 'Será apagada', now() - interval '30 seconds');
create temp table pt_msg on commit drop as
select external_message_id as ext, id, conversation_id from public.messages where external_message_id in ('pt-1', 'pt-2', 'pt-3');
grant select on pt_msg to authenticated, service_role;
-- só para as conferências do teste (desfeito no rollback): service_role não lê estas tabelas diretamente
grant select on public.messages, public.message_edits, public.message_reactions to service_role;

set local role service_role;

-- ─── Editar: pendente até o WhatsApp confirmar ───────────────────────────────────────────────────
select is(public.commit_message_edit((select id from pt_msg where ext = 'pt-1'), 'Texto editado pelo CRM', 'b6300003-0000-4000-8000-000000000001', 'crm')->>'status', 'success', 'o CRM edita');
select is((select wa_pending_action from public.messages where external_message_id = 'pt-1'), 'edit', 'edição do CRM fica "aguardando confirmação do WhatsApp"');
select is(public.ingest_whatsapp_message_edit('pt_instance', 'pt-1', 'Texto editado pelo CRM', null)->>'status', 'confirmed', 'o eco do WhatsApp (mesmo texto) confirma');
select is((select wa_pending_action from public.messages where external_message_id = 'pt-1'), null, 'a marca de pendência some');
select is((select edit_count::int from public.messages where external_message_id = 'pt-1'), 1, 'a confirmação não conta como nova edição');
select is(public.ingest_whatsapp_message_edit('pt_instance', 'pt-1', 'Texto editado pelo CRM', null)->>'status', 'unchanged', 'o mesmo eco de novo não muda nada');

select is(public.commit_message_edit((select id from pt_msg where ext = 'pt-1'), 'Segunda edição do CRM', 'b6300003-0000-4000-8000-000000000001', 'crm')->>'status', 'success', 'outra edição do CRM');
select is(public.ingest_whatsapp_message_edit('pt_instance', 'pt-1', 'Editada no celular', null)->>'status', 'success', 'edição feita no celular com outro texto vale');
select is((select wa_pending_action from public.messages where external_message_id = 'pt-1'), null, 'edição vinda do WhatsApp limpa a pendência');
select is((select count(*)::int from public.message_edits where message_id = (select id from pt_msg where ext = 'pt-1') and source = 'whatsapp'), 1, 'a edição do celular entra no histórico com source whatsapp');

-- ─── Apagar para todos ───────────────────────────────────────────────────────────────────────────
select is(public.commit_message_revoke((select id from pt_msg where ext = 'pt-3'), 'b6300003-0000-4000-8000-000000000001', 'crm')->>'status', 'success', 'o CRM apaga para todos');
select is((select wa_pending_action from public.messages where external_message_id = 'pt-3'), 'revoke', 'exclusão do CRM fica pendente');
select is(public.ingest_whatsapp_message_delete('pt_instance', 'pt-3')->>'status', 'confirmed', 'o evento de exclusão do WhatsApp confirma');
select is((select wa_pending_action from public.messages where external_message_id = 'pt-3'), null, 'pendência removida');
select ok((select deleted_at is not null and deleted_source = 'crm' from public.messages where external_message_id = 'pt-3'), 'continua apagada, com origem crm');
select is(public.ingest_whatsapp_message_delete('pt_instance', 'pt-2')->>'status', 'success', 'exclusão vinda do celular/cliente apaga');
select is((select wa_pending_action from public.messages where external_message_id = 'pt-2'), null, 'exclusão do WhatsApp nunca fica pendente');

-- ─── Reações: a conta é uma só ───────────────────────────────────────────────────────────────────
select public.commit_message_reaction((select id from pt_msg where ext = 'pt-1'), 'b6300003-0000-4000-8000-000000000001', '👍');
select is(public.ingest_whatsapp_reaction('pt_instance', 'pt-1', '5582988886301@s.whatsapp.net', true, '❤️')->>'status', 'success', 'o celular reage com outro emoji');
select is((select count(*)::int from public.message_reactions where message_id = (select id from pt_msg where ext = 'pt-1')), 1, 'uma reação só: a do celular substituiu a do membro');
select public.commit_message_reaction((select id from pt_msg where ext = 'pt-1'), 'b6300003-0000-4000-8000-000000000002', '😂');
select is((select string_agg(emoji || ':' || (is_account::text), ',') from public.message_reactions where message_id = (select id from pt_msg where ext = 'pt-1')), '😂:false', 'o membro substitui a reação do celular (e a de outro membro)');
select is(public.ingest_whatsapp_reaction('pt_instance', 'pt-1', '5582988886301@s.whatsapp.net', true, '😂')->>'reason', 'echo', 'mesmo emoji vindo do celular é eco, mantém quem reagiu');
select is((select count(*)::int from public.message_reactions where message_id = (select id from pt_msg where ext = 'pt-1')), 1, 'continua uma só');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6300000-0000-4000-8000-000000000001';
select is((public.begin_message_reaction((select id from pt_msg where ext = 'pt-1'), '😂')->>'current_emoji'), '😂', 'a reação atual da conta (de qualquer membro) vale para alternar');
select ok((select bool_and((r->>'mine')::boolean) from jsonb_array_elements((public.get_conversation_messages((select conversation_id from pt_msg where ext = 'pt-1'))->'messages')) m,
           jsonb_array_elements(m->'reactions') r where m->>'id' = (select id::text from pt_msg where ext = 'pt-1')), 'a reação da conta aparece como "minha" na leitura');
reset role;
set local role service_role;
select is(public.ingest_whatsapp_reaction('pt_instance', 'pt-1', '5582988886301@s.whatsapp.net', true, '')->>'status', 'removed', 'remover pelo celular tira a reação da conta, seja de membro ou do celular');
reset role;
select is((select count(*)::int from public.message_reactions where message_id = (select id from pt_msg where ext = 'pt-1')), 0, 'não sobra reação fantasma');

select * from finish();
rollback;
