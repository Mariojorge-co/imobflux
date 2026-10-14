begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(46);

-- ─── Fixtures: OWNER + ATTENDANT, conexão ativa com grupos ligados ──────────────────────────────
insert into auth.users (id, email)
values
    ('b5100000-0000-4000-8000-000000000001', 'pk-owner@example.test'),
    ('b5100000-0000-4000-8000-000000000002', 'pk-attendant@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5100001-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000001', 'PK Owner', 'active'),
    ('b5100001-0000-4000-8000-000000000002', 'b5100000-0000-4000-8000-000000000002', 'PK Attendant', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5100002-0000-4000-8000-000000000001', 'PK Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5100003-0000-4000-8000-000000000001', 'b5100002-0000-4000-8000-000000000001', 'b5100001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5100003-0000-4000-8000-000000000002', 'b5100002-0000-4000-8000-000000000001', 'b5100001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5100003-0000-4000-8000-000000000001');
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b5100004-0000-4000-8000-000000000001', 'b5100002-0000-4000-8000-000000000001', 'whatsapp', 'pk_instance', '+5582999905100', 'active', now(), true);
insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values ('b5100005-0000-4000-8000-000000000001', 'b5100002-0000-4000-8000-000000000001', 'Contato PK', 1, true, 'prospecting');

-- A: cliente escreveu por último (aberta)
select public.ingest_whatsapp_text_message('pk_instance', 'pk-a-1', '5582988885100@s.whatsapp.net', false, 'Cliente A', 'Oi, quero saber do apartamento', now() - interval '30 minutes');
-- B: cliente escreveu e a resposta da equipe FALHOU (a falha não conta como resposta)
select public.ingest_whatsapp_text_message('pk_instance', 'pk-b-1', '5582988885101@s.whatsapp.net', false, 'Cliente B', 'Pode me ligar?', now() - interval '40 minutes');
insert into public.messages (workspace_id, channel_connection_id, conversation_id, direction, origin, status, internal_author_member_id, client_idempotency_key, text_content, occurred_at, external_created_at, received_at)
select c.workspace_id, c.channel_connection_id, c.id, 'outgoing', 'crm', 'failed', 'b5100003-0000-4000-8000-000000000001', gen_random_uuid(), 'Claro, ligo já', now() - interval '5 minutes', null, now() - interval '5 minutes'
from public.conversations c where c.external_thread_id = '5582988885101@s.whatsapp.net';
-- C: só mensagem nossa e ela falhou (nenhuma mensagem válida para o SLA)
select public.ingest_whatsapp_text_message('pk_instance', 'pk-c-1', '5582988885102@s.whatsapp.net', true, '', 'Olá, tudo bem?', now() - interval '20 minutes');
update public.messages set status = 'failed' where external_message_id = 'pk-c-1';
-- D: arquivada (encerrada), última mensagem do cliente
select public.ingest_whatsapp_text_message('pk_instance', 'pk-d-1', '5582988885103@s.whatsapp.net', false, 'Cliente D', 'Preciso de uma proposta', now() - interval '60 minutes');
update public.conversations set operational_status = 'archived', archived_at = now() - interval '10 minutes'
where external_thread_id = '5582988885103@s.whatsapp.net';
-- E: última mensagem é de histórico (não conta para o SLA)
select public.ingest_whatsapp_history_batch('pk_instance', jsonb_build_array(
    jsonb_build_object('external_message_id', 'pk-e-1', 'remote_jid', '5582988885104@s.whatsapp.net', 'from_me', false, 'push_name', 'Cliente E', 'text_content', 'mensagem antiga', 'occurred_at', (now() - interval '2 days'))
));
-- F: conversa só nossa, enviada com sucesso (aguardando cliente)
select public.ingest_whatsapp_text_message('pk_instance', 'pk-f-1', '5582988885105@s.whatsapp.net', true, '', 'Segue o folder', now() - interval '90 minutes');
-- G: grupo restrito ao OWNER
select public.ingest_whatsapp_group_text_message('pk_instance', 'pk-g-1', '120363005100000001@g.us', '5582988885106@s.whatsapp.net', false, 'Grupo PK', 'Membro', 'oi pessoal', now() - interval '15 minutes');

-- Oportunidades ligadas às conversas A, B e D
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status)
select ('b5100006-0000-4000-8000-00000000000' || n.i)::uuid, c.workspace_id, p.contact_id, 'b5100005-0000-4000-8000-000000000001', 'Opp ' || n.t, 'open'
from (values (1, 'A', '5582988885100@s.whatsapp.net'), (2, 'B', '5582988885101@s.whatsapp.net'), (3, 'D', '5582988885103@s.whatsapp.net')) as n(i, t, jid)
join public.conversations c on c.external_thread_id = n.jid
join public.conversation_participants cp on cp.conversation_id = c.id
join public.contact_points p on p.id = cp.contact_point_id;
insert into public.opportunity_conversations (id, workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
select ('b5100007-0000-4000-8000-00000000000' || n.i)::uuid, c.workspace_id, ('b5100006-0000-4000-8000-00000000000' || n.i)::uuid, c.id, 'b5100003-0000-4000-8000-000000000001', now()
from (values (1, '5582988885100@s.whatsapp.net'), (2, '5582988885101@s.whatsapp.net'), (3, '5582988885103@s.whatsapp.net')) as n(i, jid)
join public.conversations c on c.external_thread_id = n.jid;

-- ─── Permissões da função nova ────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.get_conversation_item(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.get_conversation_item(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'public.get_conversation_item(uuid)', 'execute'),
    'get_conversation_item: só usuário autenticado (nunca anon nem service_role)'
);
select ok(
    (select not p.prosecdef and p.proconfig = array['search_path=""']::text[] from pg_catalog.pg_proc p where p.oid = 'public.get_conversation_item(uuid)'::regprocedure),
    'get_conversation_item roda como o chamador (as regras de acesso valem) e fixa search_path vazio'
);

-- ─── Lista (inbox): SLA por conversa ─────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
create temp table pk_inbox on commit drop as
select i as item from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') as i;
create temp table pk_inbox_archived on commit drop as
select i as item from jsonb_array_elements(public.get_conversations_inbox('archived', null, null, null, 100)->'items') as i;
grant select on pk_inbox, pk_inbox_archived to authenticated;

select is(
    (select item->>'sla_direction' from pk_inbox where item->>'participant_name' = 'Cliente A'),
    'incoming',
    'aberta, última do cliente: o SLA é "cliente aguardando"'
);
select ok(
    (select (item->>'sla_at')::timestamptz between now() - interval '31 minutes' and now() - interval '29 minutes'
       from pk_inbox where item->>'participant_name' = 'Cliente A'),
    'aberta, última do cliente: a hora do SLA é a da mensagem do cliente'
);
select is(
    (select item->>'sla_direction' from pk_inbox where item->>'participant_name' = 'Cliente B'),
    'incoming',
    'resposta que FALHOU não conta como resposta: o cliente continua aguardando'
);
select ok(
    (select (item->>'sla_at')::timestamptz between now() - interval '41 minutes' and now() - interval '39 minutes'
       from pk_inbox where item->>'participant_name' = 'Cliente B'),
    'resposta que falhou: o relógio continua na mensagem do cliente'
);
select is(
    (select item->>'last_msg_direction' from pk_inbox where item->>'participant_name' = 'Cliente B'),
    'outgoing',
    'a prévia da lista continua mostrando a última mensagem (inclusive a que falhou)'
);
select ok(
    (select item->'sla_direction' = 'null'::jsonb and item->'sla_at' = 'null'::jsonb
       from pk_inbox where item->>'conversation_id' = (select id::text from public.conversations where external_thread_id = '5582988885102@s.whatsapp.net')),
    'conversa em que só há mensagem nossa que falhou: sem SLA'
);
select is(
    (select item->>'sla_direction' from pk_inbox where item->>'conversation_id' = (select id::text from public.conversations where external_thread_id = '5582988885105@s.whatsapp.net')),
    'outgoing',
    'aberta, última nossa: "aguardando cliente" (o contador continua nos dois sentidos)'
);
select ok(
    (select item->'sla_direction' = 'null'::jsonb and item->'sla_at' = 'null'::jsonb
       from pk_inbox where item->>'conversation_id' = (select id::text from public.conversations where external_thread_id = '5582988885104@s.whatsapp.net')),
    'última mensagem de histórico importado: sem SLA'
);
select is(
    (select count(*) from pk_inbox where item->>'participant_name' = 'Cliente D'),
    0::bigint,
    'a conversa arquivada não aparece na visão principal'
);
select ok(
    (select item->'sla_direction' = 'null'::jsonb and item->'sla_at' = 'null'::jsonb
       from pk_inbox_archived where item->>'participant_name' = 'Cliente D'),
    'conversa encerrada (arquivada): nenhum SLA, mesmo com a última mensagem do cliente'
);

-- ─── get_conversation_item: uma conversa, uma consulta ─────────────────────────────────────────────
create temp table pk_item on commit drop as
select public.get_conversation_item((select id from public.conversations where external_thread_id = '5582988885100@s.whatsapp.net')) as item;
grant select on pk_item to authenticated;

select is(
    (select item->>'participant_name' from pk_item),
    'Cliente A',
    'get_conversation_item devolve o nome do contato'
);
select is(
    (select item->>'sla_direction' from pk_item),
    'incoming',
    'get_conversation_item traz o SLA no mesmo formato da lista'
);
select ok(
    (select item ?& array['conversation_id', 'conversation_type', 'visibility', 'operational_status', 'archived_at', 'last_activity_at',
        'last_msg_text', 'last_msg_direction', 'participant_phone', 'contact_id', 'is_unread', 'assignees', 'assigned_to_me', 'sla_direction', 'sla_at', 'workspace_id'] from pk_item),
    'get_conversation_item tem todos os campos que a lista tem (mais o SLA)'
);
select is(
    (select item->>'is_unread' from pk_item),
    'true',
    'conversa com mensagem do cliente nunca lida vem como não lida (a tela marca como lida ao abrir)'
);
select ok(
    (select public.get_conversation_item('b5100009-0000-4000-8000-0000000000ff') is null),
    'conversa inexistente: nulo'
);
select ok(
    (select public.get_conversation_item((select id from public.conversations where external_thread_id = '5582988885103@s.whatsapp.net')) ->> 'sla_direction' is null),
    'get_conversation_item de conversa arquivada: sem SLA'
);
select is(
    (select public.get_conversation_item((select id from public.conversations where external_thread_id = '120363005100000001@g.us'))->>'participant_name'),
    'Grupo PK',
    'o OWNER enxerga o grupo restrito'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000002';
select ok(
    (select public.get_conversation_item((select id from public.conversations where external_thread_id = '120363005100000001@g.us')) is null),
    'ATTENDANT não recebe um grupo restrito ao OWNER (mesma regra de acesso da lista)'
);
reset role;

-- ─── Kanban: conversa encerrada não mostra SLA; falha não conta ──────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
create temp table pk_cards on commit drop as
select c as card
from jsonb_array_elements(public.get_kanban_board(50)) as stage, jsonb_array_elements(stage->'cards') as c;
grant select on pk_cards to authenticated;
select is(
    (select card->>'last_msg_direction' from pk_cards where card->>'title' = 'Opp A'),
    'incoming',
    'Kanban: conversa aberta com a última do cliente mostra SLA'
);
select is(
    (select card->>'last_msg_direction' from pk_cards where card->>'title' = 'Opp B'),
    'incoming',
    'Kanban: resposta que falhou não conta como resposta'
);
select ok(
    (select card->'last_msg_direction' = 'null'::jsonb and card->'last_msg_at' = 'null'::jsonb from pk_cards where card->>'title' = 'Opp D'),
    'Kanban: conversa encerrada (arquivada) não mostra SLA'
);
select is(
    (select card->>'has_linked_conversation' from pk_cards where card->>'title' = 'Opp D'),
    'true',
    'Kanban: a conversa encerrada continua vinculada ao card'
);
reset role;

-- ─── Reabertura: mensagem do cliente numa conversa encerrada ──────────────────────────────────────────
select is(
    (select operational_status from public.conversations where external_thread_id = '5582988885103@s.whatsapp.net'),
    'archived',
    'antes: a conversa D está encerrada'
);
-- mensagem NOSSA (enviada pelo celular) não reabre
select public.ingest_whatsapp_text_message('pk_instance', 'pk-d-2', '5582988885103@s.whatsapp.net', true, '', 'Segue a proposta', now() - interval '5 minutes');
select is(
    (select operational_status from public.conversations where external_thread_id = '5582988885103@s.whatsapp.net'),
    'archived',
    'mensagem enviada por nós numa conversa encerrada NÃO reabre'
);
-- mensagem do cliente reabre
select public.ingest_whatsapp_text_message('pk_instance', 'pk-d-3', '5582988885103@s.whatsapp.net', false, 'Cliente D', 'Obrigado! Fechado.', now() - interval '1 minute');
select results_eq(
    $$select operational_status, archived_at is null from public.conversations where external_thread_id = '5582988885103@s.whatsapp.net'$$,
    $$values ('active'::text, true)$$,
    'mensagem do cliente numa conversa encerrada reabre a conversa (volta à lista e ao SLA)'
);
select is(
    (select count(*) from public.audit_events where action = 'conversation.reopened' and workspace_id = 'b5100002-0000-4000-8000-000000000001'),
    1::bigint,
    'a reabertura automática gera um evento de auditoria (sistema)'
);
select ok(
    (select metadata::text !~ '[0-9]{8,}' and actor_type = 'system' and actor_member_id is null
       from public.audit_events where action = 'conversation.reopened' and workspace_id = 'b5100002-0000-4000-8000-000000000001' limit 1),
    'o evento de reabertura é do sistema e não guarda número nem texto'
);
select is(
    (select count(*) from public.messages where external_message_id = 'pk-d-3'),
    1::bigint,
    'a mensagem que reabriu foi gravada normalmente'
);
-- mensagem do cliente numa conversa ABERTA não gera evento
select public.ingest_whatsapp_text_message('pk_instance', 'pk-a-2', '5582988885100@s.whatsapp.net', false, 'Cliente A', 'Ainda aí?', now() - interval '1 minute');
select is(
    (select count(*) from public.audit_events where action = 'conversation.reopened' and workspace_id = 'b5100002-0000-4000-8000-000000000001'),
    1::bigint,
    'conversa já aberta não gera evento de reabertura'
);
-- grupo encerrado reabre com mensagem de participante
update public.conversations set operational_status = 'archived', archived_at = now() - interval '2 minutes'
where external_thread_id = '120363005100000001@g.us';
select public.ingest_whatsapp_group_text_message('pk_instance', 'pk-g-2', '120363005100000001@g.us', '5582988885106@s.whatsapp.net', false, 'Grupo PK', 'Membro', 'voltei', now() - interval '30 seconds');
select is(
    (select operational_status from public.conversations where external_thread_id = '120363005100000001@g.us'),
    'active',
    'mensagem de participante reabre também o grupo encerrado'
);
-- grupo encerrado e mensagem nossa (fromMe) não reabre
update public.conversations set operational_status = 'archived', archived_at = now() - interval '1 minute'
where external_thread_id = '120363005100000001@g.us';
select public.ingest_whatsapp_group_text_message('pk_instance', 'pk-g-3', '120363005100000001@g.us', '', true, 'Grupo PK', '', 'mensagem minha', now() - interval '20 seconds');
select is(
    (select operational_status from public.conversations where external_thread_id = '120363005100000001@g.us'),
    'archived',
    'mensagem nossa no grupo encerrado não reabre'
);

-- Depois de reaberta, a conversa D volta a ter SLA na lista
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
select is(
    (select i->>'sla_direction' from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') as i where i->>'participant_name' = 'Cliente D'),
    'incoming',
    'depois de reaberta, a conversa volta à lista com o SLA (cliente aguardando)'
);
select ok(
    (select (i->>'sla_at')::timestamptz > now() - interval '3 minutes' from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') as i where i->>'participant_name' = 'Cliente D'),
    'o relógio recomeça na mensagem que reabriu'
);
reset role;

-- ─── Histórico importado não reabre conversa encerrada ────────────────────────────────────────────────
select public.ingest_whatsapp_text_message('pk_instance', 'pk-h-1', '5582988885107@s.whatsapp.net', false, 'Cliente H', 'primeira', now() - interval '3 hours');
update public.conversations set operational_status = 'archived', archived_at = now() - interval '1 hour' where external_thread_id = '5582988885107@s.whatsapp.net';
select public.ingest_whatsapp_history_batch('pk_instance', jsonb_build_array(
    jsonb_build_object('external_message_id', 'pk-h-2', 'remote_jid', '5582988885107@s.whatsapp.net', 'from_me', false, 'push_name', 'Cliente H', 'text_content', 'mensagem antiga', 'occurred_at', (now() - interval '3 days'))
));
select is(
    (select operational_status from public.conversations where external_thread_id = '5582988885107@s.whatsapp.net'),
    'archived',
    'histórico importado (mesmo do cliente) não reabre a conversa encerrada'
);
select is(
    (select count(*) from public.messages where external_message_id = 'pk-h-2' and is_history),
    1::bigint,
    'a mensagem de histórico foi importada normalmente'
);
-- depois do histórico, uma mensagem ao vivo do cliente ainda reabre (o aviso vale só dentro da importação)
select public.ingest_whatsapp_text_message('pk_instance', 'pk-h-3', '5582988885107@s.whatsapp.net', false, 'Cliente H', 'voltei', now() - interval '10 seconds');
select is(
    (select operational_status from public.conversations where external_thread_id = '5582988885107@s.whatsapp.net'),
    'active',
    'mensagem ao vivo do cliente, depois da importação, reabre normalmente'
);

-- ─── Sem mensagens: sem SLA ──────────────────────────────────────────────────────────────────────────
insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at)
values ('b5100008-0000-4000-8000-000000000001', 'b5100002-0000-4000-8000-000000000001', 'b5100004-0000-4000-8000-000000000001', '5582988885199@s.whatsapp.net', 'individual', 'active', 'commercial', now() - interval '1 hour');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
select ok(
    (select public.get_conversation_item('b5100008-0000-4000-8000-000000000001') ->> 'sla_direction' is null
        and public.get_conversation_item('b5100008-0000-4000-8000-000000000001') ->> 'sla_at' is null),
    'conversa sem mensagens: sem SLA'
);
reset role;

-- ─── Envio: a fila devolve por qual instância a mensagem deve sair ──────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
create temp table pk_queue on commit drop as
select public.queue_outgoing_text_message(
    (select id from public.conversations where external_thread_id = '5582988885100@s.whatsapp.net'),
    'Olá pelo CRM', 'b5100010-0000-4000-8000-000000000001'::uuid
) as r;
grant select on pk_queue to authenticated;
select is((select r->>'status' from pk_queue), 'queued', 'a mensagem é enfileirada como antes');
select is((select r->>'instance_name' from pk_queue), 'pk_instance', 'a fila devolve a instância da conexão ativa da conversa');
select is((select r->>'connection_status' from pk_queue), 'active', 'a fila devolve o estado da conexão usada');
reset role;

-- conversa criada numa conexão que foi substituída: sai pela conexão ativa do workspace
update public.channel_connections set status = 'replaced', disconnected_at = now() where id = 'b5100004-0000-4000-8000-000000000001';
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5100004-0000-4000-8000-000000000002', 'b5100002-0000-4000-8000-000000000001', 'whatsapp', 'pk_instance_2', '+5582999905102', 'active', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
select is(
    (select public.queue_outgoing_text_message((select id from public.conversations where external_thread_id = '5582988885100@s.whatsapp.net'), 'Segunda', 'b5100010-0000-4000-8000-000000000002'::uuid)->>'instance_name'),
    'pk_instance_2',
    'conversa de conexão substituída sai pela conexão ativa do workspace'
);
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000002';
select is(
    (select public.queue_outgoing_text_message((select id from public.conversations where external_thread_id = '5582988885100@s.whatsapp.net'), 'Do atendente', 'b5100010-0000-4000-8000-000000000003'::uuid)->>'instance_name'),
    'pk_instance_2',
    'o ATTENDANT também recebe a instância (ele não lê a tabela de conexões, a função lê por ele)'
);
reset role;

-- repetir a mesma chave: duplicada, sem enviar de novo (nem precisa de instância)
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
select is(
    (select public.queue_outgoing_text_message((select id from public.conversations where external_thread_id = '5582988885100@s.whatsapp.net'), 'Segunda', 'b5100010-0000-4000-8000-000000000002'::uuid)->>'status'),
    'duplicate',
    'a mesma chave de idempotência continua devolvendo "duplicate"'
);
reset role;

-- nenhuma conexão ativa: instância nula (o app mostra "WhatsApp desconectado" e não envia)
update public.channel_connections set status = 'disconnected', disconnected_at = now() where id = 'b5100004-0000-4000-8000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
create temp table pk_queue_none on commit drop as
select public.queue_outgoing_text_message(
    (select id from public.conversations where external_thread_id = '5582988885100@s.whatsapp.net'),
    'Sem conexão', 'b5100010-0000-4000-8000-000000000004'::uuid
) as r;
grant select on pk_queue_none to authenticated;
select ok(
    (select r ? 'instance_name' and r->'instance_name' = 'null'::jsonb and r->'connection_status' = 'null'::jsonb from pk_queue_none),
    'sem conexão ativa: instância e estado nulos (o app avisa "WhatsApp desconectado")'
);
reset role;

select * from finish();
rollback;
