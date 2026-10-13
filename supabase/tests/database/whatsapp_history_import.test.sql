begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(33);

-- ─── Fixtures: OWNER + ATTENDANT, conexão ainda não pareada ────────────────────────────────
insert into auth.users (id, email)
values
    ('b4200000-0000-4000-8000-000000000001', 'hist-owner@example.test'),
    ('b4200000-0000-4000-8000-000000000002', 'hist-attendant@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b4200001-0000-4000-8000-000000000001', 'b4200000-0000-4000-8000-000000000001', 'Hist Owner', 'active'),
    ('b4200001-0000-4000-8000-000000000002', 'b4200000-0000-4000-8000-000000000002', 'Hist Attendant', 'active');

insert into public.workspaces (id, name, status, timezone)
values ('b4200002-0000-4000-8000-000000000001', 'Hist Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b4200003-0000-4000-8000-000000000001', 'b4200002-0000-4000-8000-000000000001', 'b4200001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b4200003-0000-4000-8000-000000000002', 'b4200002-0000-4000-8000-000000000001', 'b4200001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b4200003-0000-4000-8000-000000000001');

insert into public.channel_connections (id, workspace_id, provider, external_account_id, status)
values ('b4200004-0000-4000-8000-000000000001', 'b4200002-0000-4000-8000-000000000001', 'whatsapp', 'hist_instance', 'configured');

-- WhatsApp pessoal (migration 005000): grupos vêm desligados por padrão; este teste exercita a ingestão de grupos.
update public.channel_connections set ingest_groups = true;

-- ─── Permissões ──────────────────────────────────────────────────────────────────────────
select ok(
    not pg_catalog.has_function_privilege('authenticated', 'public.ingest_whatsapp_history_batch(text,jsonb)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.ingest_whatsapp_history_batch(text,jsonb)', 'execute')
    and pg_catalog.has_function_privilege('service_role', 'public.ingest_whatsapp_history_batch(text,jsonb)', 'execute'),
    'ingest_whatsapp_history_batch só é executável pelo service_role'
);
select ok(
    not pg_catalog.has_function_privilege('authenticated', 'public.record_whatsapp_history_progress(text,integer,integer,boolean,text)', 'execute')
    and pg_catalog.has_function_privilege('service_role', 'public.record_whatsapp_history_progress(text,integer,integer,boolean,text)', 'execute'),
    'record_whatsapp_history_progress só é executável pelo service_role'
);

-- Sem conexão ativa não há importação
select throws_ok(
    $$select public.ingest_whatsapp_history_batch('hist_instance', '[]'::jsonb)$$,
    '42704', 'active_whatsapp_connection_not_found',
    'lote para conexão ainda não pareada é recusado'
);

-- ─── Pareamento inicia a janela de importação ──────────────────────────────────────────────
update public.channel_connections
set status = 'active', external_phone_normalized = '+5582999904200', activated_at = now()
where id = 'b4200004-0000-4000-8000-000000000001';

select results_eq(
    $$select history_import_status, history_imported_count from public.channel_connections where id = 'b4200004-0000-4000-8000-000000000001'$$,
    $$values ('importing'::text, 0)$$,
    'o primeiro pareamento deixa a importação em "importing"'
);
select ok(
    (select history_import_started_at is not null from public.channel_connections where id = 'b4200004-0000-4000-8000-000000000001'),
    'o início da importação é registrado'
);

-- ─── Contato protegido já existente ───────────────────────────────────────────────────────
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b4200005-0000-4000-8000-000000000002', 'b4200002-0000-4000-8000-000000000001', 'Contato Protegido', 'lead', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b4200006-0000-4000-8000-000000000002', 'b4200002-0000-4000-8000-000000000001', 'b4200005-0000-4000-8000-000000000002', 'phone', '+5582977004200', '(82) 97700-4200', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');

-- ─── Lote de histórico ───────────────────────────────────────────────────────────────────
create temp table hist_result (r jsonb);
grant all on hist_result to public;

insert into hist_result
select public.ingest_whatsapp_history_batch('hist_instance', jsonb_build_array(
    -- cliente novo escreveu há 3 dias, a equipe respondeu há 3 dias (mais recente do histórico)
    jsonb_build_object('external_message_id', 'h-in-1', 'remote_jid', '5582988884200@s.whatsapp.net', 'from_me', false,
        'push_name', 'Cliente Histórico', 'text_content', 'Quero financiar um apartamento', 'occurred_at', (now() - interval '3 days')),
    jsonb_build_object('external_message_id', 'h-out-1', 'remote_jid', '5582988884200@s.whatsapp.net', 'from_me', true,
        'push_name', '', 'text_content', 'Combinado: visita sábado', 'occurred_at', (now() - interval '3 days' + interval '5 minutes')),
    -- cliente com a última mensagem (do cliente) no histórico: não pode virar "cliente aguardando"
    jsonb_build_object('external_message_id', 'h-in-2', 'remote_jid', '5582988884201@s.whatsapp.net', 'from_me', false,
        'push_name', 'Cliente Só Histórico', 'text_content', 'Pode me ligar?', 'occurred_at', (now() - interval '2 days')),
    -- fora da janela de 15 dias
    jsonb_build_object('external_message_id', 'h-old', 'remote_jid', '5582988884202@s.whatsapp.net', 'from_me', false,
        'push_name', 'Antigo', 'text_content', 'Mensagem de 20 dias', 'occurred_at', (now() - interval '20 days')),
    -- contato protegido
    jsonb_build_object('external_message_id', 'h-prot', 'remote_jid', '5582977004200@s.whatsapp.net', 'from_me', false,
        'push_name', 'Protegido', 'text_content', 'Conversa sigilosa', 'occurred_at', (now() - interval '1 day')),
    -- grupo
    jsonb_build_object('external_message_id', 'h-group', 'remote_jid', '120363004200000001@g.us', 'sender_jid', '5582988884203@s.whatsapp.net',
        'from_me', false, 'push_name', 'Membro', 'group_subject', 'Grupo Histórico', 'text_content', 'Oi pessoal', 'occurred_at', (now() - interval '2 days')),
    -- inválidas
    jsonb_build_object('external_message_id', '', 'remote_jid', '5582988884204@s.whatsapp.net', 'from_me', false,
        'text_content', 'sem id', 'occurred_at', (now() - interval '1 day')),
    jsonb_build_object('external_message_id', 'h-future', 'remote_jid', '5582988884205@s.whatsapp.net', 'from_me', false,
        'text_content', 'do futuro', 'occurred_at', (now() + interval '2 days'))
));

select is((select r->>'imported' from hist_result), '5', 'importa as 5 mensagens válidas dentro dos 15 dias');
select is((select r->>'ignored' from hist_result), '3', 'ignora fora da janela, sem id e do futuro');
select is((select r->>'failed' from hist_result), '0', 'nenhuma falha');
select is(
    (select count(*) from public.messages where is_history),
    5::bigint,
    'as 5 mensagens importadas ficam marcadas como histórico'
);
select is(
    (select count(*) from public.messages where external_message_id in ('h-old', 'h-future')),
    0::bigint,
    'mensagens fora da janela não são gravadas'
);

-- Deduplicação: o mesmo lote de novo não cria nada
select is(
    (select public.ingest_whatsapp_history_batch('hist_instance', jsonb_build_array(
        jsonb_build_object('external_message_id', 'h-in-1', 'remote_jid', '5582988884200@s.whatsapp.net', 'from_me', false,
            'push_name', 'Cliente Histórico', 'text_content', 'Quero financiar um apartamento', 'occurred_at', (now() - interval '3 days'))
    ))->>'duplicate'),
    '1',
    'reenvio do mesmo lote é tratado como duplicado'
);
select is((select count(*) from public.messages where external_message_id = 'h-in-1'), 1::bigint, 'duplicado não cria segunda mensagem');

-- Mensagem ao vivo igual a uma do histórico também não duplica
select is(
    (select public.ingest_whatsapp_text_message('hist_instance', 'h-in-1', '5582988884200@s.whatsapp.net', false, 'Cliente Histórico', 'Quero financiar um apartamento', now() - interval '3 days')->>'status'),
    'duplicate',
    'mensagem ao vivo com o mesmo id do histórico é duplicada'
);

-- Item que dispara erro de banco não derruba o lote
select is(
    (select public.ingest_whatsapp_history_batch('hist_instance', jsonb_build_array(
        jsonb_build_object('external_message_id', 'h-bad-ts', 'remote_jid', '5582988884206@s.whatsapp.net', 'from_me', false,
            'text_content', 'x', 'occurred_at', 'não é data'),
        jsonb_build_object('external_message_id', 'h-ok', 'remote_jid', '5582988884206@s.whatsapp.net', 'from_me', false,
            'push_name', 'Ok', 'text_content', 'depois do erro', 'occurred_at', (now() - interval '1 day'))
    ))->>'failed'),
    '1',
    'item inválido conta como falha e os demais seguem'
);
select is((select count(*) from public.messages where external_message_id = 'h-ok' and is_history), 1::bigint, 'o item seguinte ao erro foi importado');

select throws_ok(
    $$select public.ingest_whatsapp_history_batch('hist_instance', '{"a":1}'::jsonb)$$,
    '22023', 'invalid_history_batch',
    'lote que não é lista é recusado'
);

-- ─── Andamento / falha visível ──────────────────────────────────────────────────────────────
select public.record_whatsapp_history_progress('hist_instance', 6, 40, false, null);
select results_eq(
    $$select history_import_status, history_imported_count from public.channel_connections where id = 'b4200004-0000-4000-8000-000000000001'$$,
    $$values ('importing'::text, 6)$$,
    'progresso parcial mantém "importing" e soma o importado'
);
select public.record_whatsapp_history_progress('hist_instance', 0, 100, true, null);
select results_eq(
    $$select history_import_status, (history_import_finished_at is not null) from public.channel_connections where id = 'b4200004-0000-4000-8000-000000000001'$$,
    $$values ('completed'::text, true)$$,
    'último lote conclui a importação'
);

-- Falha: erro registrado deixa a importação como "failed" mesmo que o último lote chegue depois
update public.channel_connections
set history_import_status = 'importing', history_import_finished_at = null, history_import_error = null
where id = 'b4200004-0000-4000-8000-000000000001';
select public.record_whatsapp_history_progress('hist_instance', 0, 30, false, 'Falha ao gravar o lote');
select public.record_whatsapp_history_progress('hist_instance', 2, 100, true, null);
select results_eq(
    $$select history_import_status, history_import_error from public.channel_connections where id = 'b4200004-0000-4000-8000-000000000001'$$,
    $$values ('failed'::text, 'Falha ao gravar o lote'::text)$$,
    'erro durante a importação mantém o status "failed" com o motivo'
);

-- ─── OWNER: SLA, não lida e marcação ───────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4200000-0000-4000-8000-000000000001';

select is(
    (select i->>'last_msg_direction' from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'participant_name' = 'Cliente Só Histórico'),
    null,
    'conversa só com histórico não tem direção de SLA (sem "cliente aguardando")'
);
select is(
    (select i->>'is_unread' from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'participant_name' = 'Cliente Só Histórico'),
    'false',
    'mensagem de histórico não deixa a conversa como não lida'
);
select is(
    (select i->>'last_msg_text' from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'participant_name' = 'Cliente Só Histórico'),
    'Pode me ligar?',
    'a prévia da conversa ainda mostra a última mensagem do histórico'
);
select is(
    (select count(*) from jsonb_array_elements(public.get_conversation_messages(
        (select id from public.conversations where external_thread_id = '5582988884200@s.whatsapp.net')
    )->'messages') m where (m->>'is_history')::boolean),
    2::bigint,
    'get_conversation_messages marca o histórico (is_history)'
);

-- Mensagem ao vivo depois do histórico passa a valer para o SLA
reset role;
select public.ingest_whatsapp_text_message('hist_instance', 'live-1', '5582988884201@s.whatsapp.net', false, 'Cliente Só Histórico', 'Alô?', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'b4200000-0000-4000-8000-000000000001';

select is(
    (select i->>'last_msg_direction' from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'participant_name' = 'Cliente Só Histórico'),
    'incoming',
    'mensagem ao vivo depois do histórico volta a contar para o SLA'
);
select is(
    (select i->>'is_unread' from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'participant_name' = 'Cliente Só Histórico'),
    'true',
    'mensagem ao vivo marca como não lida'
);
select is(
    (select count(*) from jsonb_array_elements(public.get_conversation_messages(
        (select id from public.conversations where external_thread_id = '5582988884201@s.whatsapp.net')
    )->'messages') m where (m->>'is_history')::boolean),
    1::bigint,
    'só a mensagem do histórico fica marcada; a ao vivo não'
);

-- ─── Privacidade (ATTENDANT) ─────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b4200000-0000-4000-8000-000000000002';

select is(
    (select count(*) from public.messages where external_message_id = 'h-prot'),
    0::bigint,
    'ATTENDANT não vê o histórico de contato protegido'
);
select is(
    (select count(*) from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'participant_name' = 'Contato Protegido'),
    0::bigint,
    'a conversa do contato protegido continua fora da lista do ATTENDANT'
);
select is(
    (select count(*) from public.messages where external_message_id = 'h-group'),
    0::bigint,
    'ATTENDANT não vê histórico de grupo ainda não liberado'
);
select is(
    (select count(*) from public.messages where external_message_id = 'h-in-1'),
    1::bigint,
    'ATTENDANT vê o histórico de conversa individual comercial'
);

-- Grupo liberado: histórico de remetente comum aparece; de contato protegido continua oculto
reset role;
select public.ingest_whatsapp_history_batch('hist_instance', jsonb_build_array(
    jsonb_build_object('external_message_id', 'h-group-prot', 'remote_jid', '120363004200000001@g.us', 'sender_jid', '5582977004200@s.whatsapp.net',
        'from_me', false, 'push_name', 'Protegido', 'group_subject', 'Grupo Histórico', 'text_content', 'segredo no grupo', 'occurred_at', (now() - interval '1 day'))
));
update public.conversations
set visibility = 'commercial',
    commercial_visible_from = greatest(started_at, created_at),
    privacy_changed_at = greatest(started_at, created_at)
where external_thread_id = '120363004200000001@g.us';

set local role authenticated;
set local "request.jwt.claim.sub" = 'b4200000-0000-4000-8000-000000000002';

select is(
    (select count(*) from public.messages where external_message_id = 'h-group'),
    1::bigint,
    'grupo liberado: o histórico de remetente comum fica visível ao ATTENDANT'
);
select is(
    (select count(*) from public.messages where external_message_id = 'h-group-prot'),
    0::bigint,
    'grupo liberado: o histórico de contato protegido continua oculto ao ATTENDANT'
);

-- ATTENDANT não lê o status da importação (conexão é só do OWNER)
select is(
    (select count(*) from public.channel_connections),
    0::bigint,
    'ATTENDANT não enxerga a conexão nem o status da importação'
);

select * from finish();
rollback;
