begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(82);

-- ─── Fixtures: workspace A (owner, atendente 1 e 2, conexão), workspace B (owner) ─────────────────
insert into auth.users (id, email)
values
    ('b5800000-0000-4000-8000-000000000001', 'ma-owner@example.test'),
    ('b5800000-0000-4000-8000-000000000002', 'ma-att1@example.test'),
    ('b5800000-0000-4000-8000-000000000003', 'ma-att2@example.test'),
    ('b5800000-0000-4000-8000-000000000004', 'ma-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5800001-0000-4000-8000-000000000001', 'b5800000-0000-4000-8000-000000000001', 'MA Owner', 'active'),
    ('b5800001-0000-4000-8000-000000000002', 'b5800000-0000-4000-8000-000000000002', 'MA Att1', 'active'),
    ('b5800001-0000-4000-8000-000000000003', 'b5800000-0000-4000-8000-000000000003', 'MA Att2', 'active'),
    ('b5800001-0000-4000-8000-000000000004', 'b5800000-0000-4000-8000-000000000004', 'MA Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b5800002-0000-4000-8000-000000000001', 'MA Workspace A', 'active', 'America/Maceio'),
    ('b5800002-0000-4000-8000-000000000002', 'MA Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5800003-0000-4000-8000-000000000001', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5800003-0000-4000-8000-000000000002', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5800003-0000-4000-8000-000000000001'),
    ('b5800003-0000-4000-8000-000000000003', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b5800003-0000-4000-8000-000000000001'),
    ('b5800003-0000-4000-8000-000000000004', 'b5800002-0000-4000-8000-000000000002', 'b5800001-0000-4000-8000-000000000004', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b5800004-0000-4000-8000-000000000001', 'b5800002-0000-4000-8000-000000000001', 'whatsapp', 'ma_instance', '+5582999905800', 'active', now(), true);

-- Conversa de cliente (visível ao atendente), conversa protegida e grupo
select public.ingest_whatsapp_text_message('ma_instance', 'ma-in-1', '5582988885800@s.whatsapp.net', false, 'Cliente MA', 'Oi, quero o apartamento', now() - interval '30 minutes');
select public.ingest_whatsapp_text_message('ma_instance', 'ma-in-2', '5582988885801@s.whatsapp.net', false, 'Cliente Protegido', 'Oi', now() - interval '30 minutes');
update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988885801');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988885801';
select public.ingest_whatsapp_group_text_message('ma_instance', 'ma-g-1', '120363005800000001@g.us', '5582988885802@s.whatsapp.net', false, 'Grupo MA', 'Membro', 'oi pessoal', now() - interval '20 minutes');
update public.conversations set visibility = 'commercial', commercial_visible_from = clock_timestamp() where conversation_type = 'group' and external_thread_id = '120363005800000001@g.us';

create temp table ma_ids on commit drop as
select
    (select id from public.conversations where external_thread_id = '5582988885800@s.whatsapp.net') as conv,
    (select id from public.conversations where external_thread_id = '5582988885801@s.whatsapp.net') as prot,
    (select id from public.conversations where external_thread_id = '120363005800000001@g.us') as grp,
    (select id from public.messages where external_message_id = 'ma-in-1') as incoming,
    (select id from public.messages where external_message_id = 'ma-in-2') as incoming_prot,
    (select id from public.messages where external_message_id = 'ma-g-1') as incoming_group;
grant select on ma_ids to authenticated, service_role;

-- Mensagens enviadas pelo CRM: m1 (att1, recente), m2 (att2, recente), m3 (att1, há 20 min), m4 (att1, há 3 dias),
-- m5 (att1, na fila), m6 (att1, com arquivo), m7 (na conversa protegida, owner)
create or replace function pg_temp.crm_message(p_n int, p_author text, p_age interval, p_status text, p_conv uuid, p_text text) returns uuid
language sql as $f$
    insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, external_message_id, client_idempotency_key,
        direction, origin, internal_author_member_id, text_content, status, occurred_at)
    select ('b5800005-0000-4000-8000-00000000000' || p_n)::uuid, c.workspace_id, c.channel_connection_id, c.id,
        case when p_status = 'queued' then null else 'ma-crm-' || p_n end, gen_random_uuid(), 'outgoing', 'crm', p_author::uuid, p_text, p_status, now() - p_age
    from public.conversations c where c.id = p_conv
    returning id;
$f$;
select pg_temp.crm_message(1, 'b5800003-0000-4000-8000-000000000002', interval '2 minutes', 'sent', (select conv from ma_ids), 'Mensagem do atendente 1');
select pg_temp.crm_message(2, 'b5800003-0000-4000-8000-000000000003', interval '2 minutes', 'sent', (select conv from ma_ids), 'Mensagem do atendente 2');
select pg_temp.crm_message(3, 'b5800003-0000-4000-8000-000000000002', interval '20 minutes', 'sent', (select conv from ma_ids), 'Mensagem antiga do atendente 1');
select pg_temp.crm_message(4, 'b5800003-0000-4000-8000-000000000002', interval '3 days', 'sent', (select conv from ma_ids), 'Mensagem de 3 dias');
select pg_temp.crm_message(5, 'b5800003-0000-4000-8000-000000000002', interval '1 minute', 'queued', (select conv from ma_ids), 'Ainda na fila');
select pg_temp.crm_message(6, 'b5800003-0000-4000-8000-000000000002', interval '1 minute', 'sent', (select conv from ma_ids), 'Legenda do arquivo');
select pg_temp.crm_message(7, 'b5800003-0000-4000-8000-000000000001', interval '1 minute', 'sent', (select prot from ma_ids), 'Mensagem na conversa protegida');
insert into public.attachments (workspace_id, message_id, storage_bucket, storage_key, original_file_name, mime_type, size_bytes, status, available_at)
values ('b5800002-0000-4000-8000-000000000001', 'b5800005-0000-4000-8000-000000000006', 'whatsapp-media', 'b5800002-0000-4000-8000-000000000001/x/out/b5800006-0000-4000-8000-000000000001', 'contrato.pdf', 'application/pdf', 100, 'available', now());

-- ─── Permissões e forma ──────────────────────────────────────────────────────────────────────────
select ok(
    (select bool_and(pg_catalog.has_function_privilege('authenticated', f, 'execute')
        and not pg_catalog.has_function_privilege('anon', f, 'execute') and not pg_catalog.has_function_privilege('service_role', f, 'execute'))
     from unnest(array['public.set_message_reply(uuid,uuid)', 'public.begin_message_edit(uuid,text)', 'public.begin_message_revoke(uuid)',
        'public.hide_message(uuid)', 'public.restore_hidden_message(uuid)', 'public.get_message_for_forward(uuid)',
        'public.mark_message_forwarded(uuid,uuid)', 'public.begin_message_reaction(uuid,text)']) as f),
    'funções do usuário: só autenticado (nunca anon nem service_role)'
);
select ok(
    (select bool_and(pg_catalog.has_function_privilege('service_role', f, 'execute')
        and not pg_catalog.has_function_privilege('anon', f, 'execute') and not pg_catalog.has_function_privilege('authenticated', f, 'execute'))
     from unnest(array['public.commit_message_edit(uuid,text,uuid,text)', 'public.commit_message_revoke(uuid,uuid,text)',
        'public.commit_message_reaction(uuid,uuid,text)', 'public.set_incoming_message_reply(uuid,text,jsonb)',
        'public.ingest_whatsapp_message_edit(text,text,text,timestamptz)', 'public.ingest_whatsapp_message_delete(text,text)',
        'public.ingest_whatsapp_reaction(text,text,text,boolean,text)']) as f),
    'funções de gravação e do webhook: só o servidor'
);
select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']::text[]) from pg_catalog.pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.proname in ('set_message_reply', 'begin_message_edit', 'commit_message_edit', 'begin_message_revoke', 'commit_message_revoke',
          'hide_message', 'restore_hidden_message', 'get_message_for_forward', 'mark_message_forwarded', 'begin_message_reaction',
          'commit_message_reaction', 'set_incoming_message_reply', 'ingest_whatsapp_message_edit', 'ingest_whatsapp_message_delete',
          'ingest_whatsapp_reaction', 'outgoing_route', 'load_action_message', 'message_snapshot', 'apply_message_deletion', 'find_message_by_external')),
    'todas SECURITY DEFINER com search_path vazio'
);
select ok(
    (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c where c.oid in ('public.message_edits'::regclass, 'public.message_deletions'::regclass, 'public.message_reactions'::regclass))
    and not pg_catalog.has_table_privilege('authenticated', 'public.message_reactions', 'insert')
    and not pg_catalog.has_table_privilege('authenticated', 'public.message_edits', 'update')
    and not pg_catalog.has_table_privilege('anon', 'public.message_deletions', 'select'),
    'tabelas novas: RLS ligada, sem escrita direta, anon sem leitura'
);

-- ─── RESPONDER ───────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select is((public.set_message_reply('b5800005-0000-4000-8000-000000000005', (select incoming from ma_ids))->>'status'), 'success', 'atendente responde a uma mensagem do cliente (na própria mensagem)');
select is((select reply_snapshot->>'author' from public.messages where id = 'b5800005-0000-4000-8000-000000000005'), 'Cliente MA', 'citação guarda quem escreveu');
select is((select reply_snapshot->>'text' from public.messages where id = 'b5800005-0000-4000-8000-000000000005'), 'Oi, quero o apartamento', 'e o trecho do texto');
select is((select reply_to_external_id from public.messages where id = 'b5800005-0000-4000-8000-000000000005'), 'ma-in-1', 'e o id do WhatsApp da original (para a Evolution citar)');
select throws_ok($$select public.set_message_reply('b5800005-0000-4000-8000-000000000002', (select incoming from ma_ids))$$, '42501', 'message_action_not_authorized', 'atendente não define citação na mensagem de outro');
select throws_ok(format($$select public.set_message_reply('b5800005-0000-4000-8000-000000000001', %L)$$, (select incoming_prot from ma_ids)), 'P0002', 'message_not_found', 'não cita mensagem de outra conversa');
reset role;

-- Citação recebida (cliente respondeu a uma mensagem nossa e a uma que não está no CRM)
select public.ingest_whatsapp_text_message('ma_instance', 'ma-in-3', '5582988885800@s.whatsapp.net', false, 'Cliente MA', 'Respondendo à sua mensagem', now());
create temp table ma_in3 on commit drop as select id from public.messages where external_message_id = 'ma-in-3';
grant select on ma_in3 to authenticated, service_role;
select is((public.set_incoming_message_reply((select id from ma_in3), 'ma-crm-1', null)->>'resolved')::boolean, true, 'citação recebida cuja original está no CRM é resolvida');
select is((select reply_snapshot->>'text' from public.messages where external_message_id = 'ma-in-3'), 'Mensagem do atendente 1', 'e usa o texto da original do CRM');
select is((public.set_incoming_message_reply((select id from ma_in3), 'ma-desconhecida', jsonb_build_object('author', 'Fulano', 'text', 'texto antigo'))->>'resolved')::boolean, false, 'original fora do CRM: usa o trecho que veio no evento');
select is((select reply_snapshot->>'text' from public.messages where external_message_id = 'ma-in-3'), 'texto antigo', 'trecho guardado');

-- ─── EDITAR ──────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select is((public.begin_message_edit('b5800005-0000-4000-8000-000000000001', 'Texto corrigido')->>'external_message_id'), 'ma-crm-1', 'atendente edita a própria mensagem recente');
select is((public.begin_message_edit('b5800005-0000-4000-8000-000000000001', 'Texto corrigido')->>'instance_name'), 'ma_instance', 'devolve a instância e o destinatário');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000002', 'x')$$, '42501', 'message_action_not_authorized', 'atendente NÃO edita a mensagem de outro atendente');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000003', 'Novo texto')$$, '22023', 'message_edit_window_expired', 'depois de 15 minutos não edita');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000006', 'Nova legenda')$$, '22023', 'message_edit_not_supported', 'mensagem com arquivo (legenda) não é editada');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000005', 'Novo')$$, '22023', 'message_action_not_allowed', 'mensagem ainda na fila não é editada');
select throws_ok(format($$select public.begin_message_edit(%L, 'Novo')$$, (select incoming from ma_ids)), '22023', 'message_action_not_allowed', 'mensagem do cliente não é editável (nem por atendente)');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000001', 'Mensagem do atendente 1')$$, '22023', 'message_edit_unchanged', 'texto igual ao atual é recusado');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000001', '   ')$$, '22023', 'message_text_invalid', 'texto vazio é recusado');
select throws_ok(format($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000001', %L)$$, repeat('a', 4097)), '22023', 'message_text_invalid', 'acima de 4096 caracteres é recusado');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000007', 'x')$$, '42501', 'message_action_not_authorized', 'atendente não edita em conversa que não enxerga');
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select is((public.begin_message_edit('b5800005-0000-4000-8000-000000000002', 'Dono corrige')->>'status'), 'ready', 'dono edita qualquer mensagem enviada pelo CRM');
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000004';
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000001', 'x')$$, 'P0002', 'message_not_found', 'owner de outro workspace não alcança a mensagem');
reset role;
set local role anon;
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000001', 'x')$$, '42501', null, 'anon não executa');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select throws_ok($$select public.commit_message_edit('b5800005-0000-4000-8000-000000000001', 'Texto corrigido', 'b5800003-0000-4000-8000-000000000002', 'crm')$$, '42501', null, 'o navegador não grava edição direto (só o servidor, depois da Evolution)');
reset role;
set local role service_role;
select is((public.commit_message_edit('b5800005-0000-4000-8000-000000000001', 'Texto corrigido', 'b5800003-0000-4000-8000-000000000002', 'crm')->>'status'), 'success', 'servidor grava a edição depois que a Evolution aceitou');
select is((public.commit_message_edit('b5800005-0000-4000-8000-000000000001', 'Texto corrigido', 'b5800003-0000-4000-8000-000000000002', 'crm')->>'status'), 'unchanged', 'repetir a mesma edição não faz nada (eco)');
reset role;
select is((select text_content || '|' || edit_count::text from public.messages where id = 'b5800005-0000-4000-8000-000000000001'), 'Texto corrigido|1', 'texto novo e contador de edições');
select ok((select edited_at is not null from public.messages where id = 'b5800005-0000-4000-8000-000000000001'), 'marca de editada');
select is((select previous_text from public.message_edits where message_id = 'b5800005-0000-4000-8000-000000000001'), 'Mensagem do atendente 1', 'o texto anterior fica no histórico');
select is((select count(*)::int from public.audit_events where action = 'message.edited' and (metadata::text like '%corrigido%' or metadata::text like '%atendente%')), 0, 'a auditoria da edição não guarda o texto');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.message_edits), 0, 'atendente NÃO lê o histórico de edições');
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.message_edits), 1, 'o dono lê o histórico de edições');
reset role;

-- Edição vinda do WhatsApp (celular): idempotente e marca como editada
set local role service_role;
select is((public.ingest_whatsapp_message_edit('ma_instance', 'ma-crm-2', 'Editada pelo celular', now())->>'status'), 'success', 'edição feita no celular atualiza a mensagem');
select is((public.ingest_whatsapp_message_edit('ma_instance', 'ma-crm-2', 'Editada pelo celular', now())->>'status'), 'unchanged', 'o mesmo evento de novo não reaplica');
select is((public.ingest_whatsapp_message_edit('ma_instance', 'inexistente', 'x', now())->>'reason'), 'unknown_message', 'edição de mensagem desconhecida é ignorada');
select is((public.ingest_whatsapp_message_edit('ma_instance', 'ma-crm-6', 'Nova legenda', now())->>'reason'), 'media_caption', 'edição de legenda de arquivo é ignorada (não suportado)');
reset role;
select is((select source from public.message_edits where message_id = 'b5800005-0000-4000-8000-000000000002'), 'whatsapp', 'a origem da edição fica registrada');

-- ─── APAGAR PARA TODOS ───────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select is((public.begin_message_revoke('b5800005-0000-4000-8000-000000000003')->>'external_message_id'), 'ma-crm-3', 'atendente apaga para todos a própria mensagem dentro da janela');
select throws_ok($$select public.begin_message_revoke('b5800005-0000-4000-8000-000000000004')$$, '22023', 'message_revoke_window_expired', 'depois de 48 horas não apaga para todos');
select throws_ok($$select public.begin_message_revoke('b5800005-0000-4000-8000-000000000002')$$, '42501', 'message_action_not_authorized', 'atendente não apaga para todos a mensagem de outro');
select throws_ok(format($$select public.begin_message_revoke(%L)$$, (select incoming from ma_ids)), '22023', 'message_action_not_allowed', 'nem a mensagem do cliente');
reset role;
set local role service_role;
select is((public.commit_message_revoke('b5800005-0000-4000-8000-000000000003', 'b5800003-0000-4000-8000-000000000002', 'crm')->>'status'), 'success', 'servidor grava a exclusão depois da Evolution');
select is((public.commit_message_revoke('b5800005-0000-4000-8000-000000000003', 'b5800003-0000-4000-8000-000000000002', 'crm')->>'status'), 'unchanged', 'apagar de novo não faz nada');
reset role;
select ok((select text_content is null and deleted_at is not null and deleted_source = 'crm' from public.messages where id = 'b5800005-0000-4000-8000-000000000003'), 'a mensagem fica sem o texto e marcada como apagada');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select is((select original_text from public.message_deletions where message_id = 'b5800005-0000-4000-8000-000000000003'), 'Mensagem antiga do atendente 1', 'o original fica preservado só para o dono');
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.message_deletions), 0, 'atendente NÃO lê o conteúdo apagado');
select throws_ok($$select public.begin_message_edit('b5800005-0000-4000-8000-000000000003', 'ressuscitar')$$, '22023', 'message_action_not_allowed', 'mensagem apagada não pode mais ser editada');
reset role;
-- Apagada pelo cliente/celular via webhook (a citação de ma-in-3 aponta para ma-in-1)
set local role service_role;
select public.set_incoming_message_reply((select id from ma_in3), 'ma-in-1', null);
select is((public.ingest_whatsapp_message_delete('ma_instance', 'ma-in-1')->>'status'), 'success', 'cliente apagou a própria mensagem: o CRM acompanha');
select is((public.ingest_whatsapp_message_delete('ma_instance', 'ma-in-1')->>'status'), 'unchanged', 'e o mesmo evento de novo não reaplica');
reset role;
select is((select deleted_source from public.messages where external_message_id = 'ma-in-1'), 'whatsapp', 'origem da exclusão: WhatsApp');
select is((select reply_snapshot->>'text' from public.messages where external_message_id = 'ma-in-3'), null, 'a citação da mensagem apagada deixa de mostrar o texto');
select is((select count(*)::int from public.audit_events where action = 'message.deleted_for_everyone' and metadata::text like '%antiga%'), 0, 'a auditoria da exclusão não guarda o texto');

-- ─── APAGAR PARA MIM ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000003';
select is((public.hide_message('b5800005-0000-4000-8000-000000000001')->>'status'), 'success', 'atendente esconde uma mensagem no ImobFlux');
select is((public.hide_message('b5800005-0000-4000-8000-000000000001')->>'status'), 'unchanged', 'esconder de novo não faz nada');
select throws_ok($$select public.restore_hidden_message('b5800005-0000-4000-8000-000000000001')$$, '42501', 'message_action_not_authorized', 'atendente NÃO restaura');
select throws_ok(format($$select public.hide_message(%L)$$, (select incoming_prot from ma_ids)), '42501', 'message_action_not_authorized', 'não esconde mensagem de conversa que não enxerga');
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select is((public.restore_hidden_message('b5800005-0000-4000-8000-000000000001')->>'status'), 'success', 'o dono restaura');
reset role;
select is((select hidden_at from public.messages where id = 'b5800005-0000-4000-8000-000000000001'), null, 'mensagem volta a aparecer');
select is((select count(*)::int from public.audit_events where action in ('message.hidden', 'message.restored')), 2, 'esconder e restaurar auditados');

-- ─── ENCAMINHAR ──────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select is((public.get_message_for_forward('b5800005-0000-4000-8000-000000000006')->'attachments'->0->>'file_name'), 'contrato.pdf', 'encaminhar devolve o texto e os arquivos já guardados');
select throws_ok($$select public.get_message_for_forward('b5800005-0000-4000-8000-000000000003')$$, '22023', 'message_action_not_allowed', 'mensagem apagada não é encaminhada');
select throws_ok($$select public.get_message_for_forward('b5800005-0000-4000-8000-000000000007')$$, '42501', 'message_action_not_authorized', 'atendente não encaminha mensagem de conversa que não enxerga');
select is((public.mark_message_forwarded('b5800005-0000-4000-8000-000000000001', 'b5800005-0000-4000-8000-000000000002')->>'status'), 'success', 'marca a mensagem enviada como encaminhada');
reset role;
select is((select forwarded from public.messages where id = 'b5800005-0000-4000-8000-000000000001'), true, 'marca "encaminhada" gravada');

-- ─── REAÇÕES ─────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000002';
select is((public.begin_message_reaction((select id from ma_in3), '👍')->>'from_me')::boolean, false, 'reagir a mensagem do cliente (from_me falso)');
select is((public.begin_message_reaction('b5800005-0000-4000-8000-000000000001', '👍')->>'from_me')::boolean, true, 'reagir a mensagem nossa (from_me verdadeiro)');
select throws_ok(format($$select public.begin_message_reaction(%L, '👍')$$, (select incoming_group from ma_ids)), '22023', 'reaction_not_supported_group', 'em grupo não há reação (sem envio em grupos)');
select throws_ok(format($$select public.begin_message_reaction(%L, '👍')$$, (select incoming_prot from ma_ids)), '42501', 'message_action_not_authorized', 'atendente não reage em conversa que não enxerga');
reset role;
set local role service_role;
select is((public.commit_message_reaction('b5800005-0000-4000-8000-000000000001', 'b5800003-0000-4000-8000-000000000002', '👍')->>'status'), 'success', 'grava a reação do atendente');
select is((public.commit_message_reaction('b5800005-0000-4000-8000-000000000001', 'b5800003-0000-4000-8000-000000000002', '❤️')->>'emoji'), '❤️', 'trocar a reação substitui (uma por pessoa)');
select is((public.ingest_whatsapp_reaction('ma_instance', 'ma-crm-1', '5582988885800@s.whatsapp.net', false, '😂')->>'status'), 'success', 'reação do cliente chega pelo webhook');
select is((public.ingest_whatsapp_reaction('ma_instance', 'ma-crm-1', '5582988885800@s.whatsapp.net', true, '🙏')->>'status'), 'success', 'reação feita no celular (conta) também');
select is((public.ingest_whatsapp_reaction('ma_instance', 'ma-crm-1', '5582977770000@s.whatsapp.net', false, '😂')->>'reason'), 'unknown_reactor', 'quem não é contato conhecido é ignorado');
reset role;
select is((select count(*)::int from public.message_reactions where message_id = 'b5800005-0000-4000-8000-000000000001'), 2, 'duas reações: cliente e conta (a do celular substituiu a do atendente: a conta é uma só)');
set local role service_role;
select is((public.commit_message_reaction('b5800005-0000-4000-8000-000000000001', 'b5800003-0000-4000-8000-000000000002', '')->>'status'), 'removed', 'emoji vazio remove a reação da nossa conta, venha de onde vier');
select is((public.ingest_whatsapp_reaction('ma_instance', 'ma-crm-1', '5582988885800@s.whatsapp.net', false, '')->>'status'), 'removed', 'cliente remove a reação');
reset role;
select is((select count(*)::int from public.message_reactions where message_id = 'b5800005-0000-4000-8000-000000000001'), 0, 'remover tira a reação da nossa conta (membro ou celular) e a do cliente: não sobra nenhuma');

select * from finish();
rollback;
