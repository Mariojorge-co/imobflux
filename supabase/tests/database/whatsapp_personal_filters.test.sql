begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(78);

-- ─── Fixtures: OWNER + ATTENDANT, duas conexões (uma ativa já pareada, uma ainda não pareada) ──────
insert into auth.users (id, email)
values
    ('b5000000-0000-4000-8000-000000000001', 'pers-owner@example.test'),
    ('b5000000-0000-4000-8000-000000000002', 'pers-attendant@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5000001-0000-4000-8000-000000000001', 'b5000000-0000-4000-8000-000000000001', 'Pers Owner', 'active'),
    ('b5000001-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000002', 'Pers Attendant', 'active');

insert into public.workspaces (id, name, status, timezone)
values ('b5000002-0000-4000-8000-000000000001', 'Pers Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5000003-0000-4000-8000-000000000001', 'b5000002-0000-4000-8000-000000000001', 'b5000001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5000003-0000-4000-8000-000000000002', 'b5000002-0000-4000-8000-000000000001', 'b5000001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5000003-0000-4000-8000-000000000001');

-- Conexão ainda não pareada (configurada). Usada nos testes de gatilho e da tela de configuração.
insert into public.channel_connections (id, workspace_id, provider, external_account_id, status)
values ('b5000004-0000-4000-8000-000000000001', 'b5000002-0000-4000-8000-000000000001', 'whatsapp', 'pers-instance', 'configured');

-- ─── Colunas novas e padrões ──────────────────────────────────────────────────────────────────
select results_eq(
    $$select history_window_days::int, ingest_groups, ingest_only_known_contacts, ignored_counts::text
      from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'$$,
    $$values (15, false, false, '{}'::text)$$,
    'padrões: histórico 15 dias, grupos desligados, modo "só cadastrados" desligado, contadores vazios'
);
select throws_ok(
    $$update public.channel_connections set history_window_days = 16 where id = 'b5000004-0000-4000-8000-000000000001'$$,
    '23514', null, 'janela de histórico acima de 15 dias é recusada'
);
select throws_ok(
    $$update public.channel_connections set history_window_days = -1 where id = 'b5000004-0000-4000-8000-000000000001'$$,
    '23514', null, 'janela de histórico negativa é recusada'
);
select lives_ok(
    $$update public.channel_connections set history_window_days = 0 where id = 'b5000004-0000-4000-8000-000000000001'$$,
    'janela 0 é aceita'
);
select lives_ok(
    $$update public.channel_connections set history_window_days = 15 where id = 'b5000004-0000-4000-8000-000000000001'$$,
    'janela 15 é aceita'
);

-- ─── Permissões ──────────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.update_whatsapp_ingest_settings(boolean,boolean,integer)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.update_whatsapp_ingest_settings(boolean,boolean,integer)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'public.update_whatsapp_ingest_settings(boolean,boolean,integer)', 'execute'),
    'update_whatsapp_ingest_settings: só usuário autenticado (nunca anon nem service_role)'
);
select ok(
    not pg_catalog.has_function_privilege('authenticated', 'private.count_ignored_whatsapp_message(text,text)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'private.count_ignored_whatsapp_message(text,text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'private.count_ignored_whatsapp_message(text,text)', 'execute'),
    'o contador interno não é chamável por ninguém de fora'
);
select ok(
    not pg_catalog.has_function_privilege('authenticated', 'private.phone_match_candidates(text)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'private.phone_match_candidates(text)', 'execute'),
    'a função de variantes de telefone é interna'
);

-- ─── Variantes de telefone (9º dígito, DDI) ───────────────────────────────────────────────────
select is(
    (select array(select unnest(private.phone_match_candidates('+5582988880002')) order by 1)),
    array['+558288880002', '+5582988880002']::text[],
    'celular com 9º dígito também casa sem o 9'
);
select is(
    (select array(select unnest(private.phone_match_candidates('+558288880002')) order by 1)),
    array['+558288880002', '+5582988880002']::text[],
    'celular sem 9º dígito também casa com o 9'
);
select is(
    (select array(select unnest(private.phone_match_candidates('+558221234567')) order by 1)),
    array['+558221234567']::text[],
    'fixo (começa com 2) não ganha variante com 9'
);
select is(
    (select array(select unnest(private.phone_match_candidates('+14155550123')) order by 1)),
    array['+14155550123']::text[],
    'número internacional só casa exato'
);

-- Com a janela padrão (15), o pareamento marca "importing"
insert into public.channel_connections (id, workspace_id, provider, external_account_id, status)
values ('b5000004-0000-4000-8000-000000000002', 'b5000002-0000-4000-8000-000000000001', 'whatsapp', 'pers-instance-15', 'configured');
update public.channel_connections
set status = 'active', external_phone_normalized = '+5582999905015', activated_at = now()
where id = 'b5000004-0000-4000-8000-000000000002';
select is(
    (select history_import_status from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000002'),
    'importing',
    'janela 15 (padrão): o pareamento continua marcando "importing"'
);
-- Só pode haver uma conexão ativa por workspace: esta sai de cena antes da conexão principal ser ativada.
update public.channel_connections set status = 'replaced', disconnected_at = now() where id = 'b5000004-0000-4000-8000-000000000002';

-- ─── Pareamento e histórico: gatilho respeita a janela ────────────────────────────────────────
update public.channel_connections set history_window_days = 0 where id = 'b5000004-0000-4000-8000-000000000001';
update public.channel_connections
set status = 'active', external_phone_normalized = '+5582999905000', activated_at = now()
where id = 'b5000004-0000-4000-8000-000000000001';

select results_eq(
    $$select history_import_status, history_import_started_at is null from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'$$,
    $$values (null::text, true)$$,
    'janela 0: o pareamento NÃO marca a importação como "importing"'
);

-- Lote de histórico com janela 0 é descartado inteiro
create temp table pers_result (label text, r jsonb);
grant all on pers_result to public;

insert into pers_result
select 'hist0', public.ingest_whatsapp_history_batch('pers-instance', jsonb_build_array(
    jsonb_build_object('external_message_id', 'ph-1', 'remote_jid', '5582988885001@s.whatsapp.net', 'from_me', false,
        'push_name', 'Histórico Zero', 'text_content', 'não deve entrar', 'occurred_at', (now() - interval '1 day')),
    jsonb_build_object('external_message_id', 'ph-2', 'remote_jid', '5582988885002@s.whatsapp.net', 'from_me', true,
        'push_name', '', 'text_content', 'nem esta', 'occurred_at', (now() - interval '2 hours'))
));
select is((select r->>'imported' from pers_result where label = 'hist0'), '0', 'janela 0: nada é importado');
select is((select r->>'ignored' from pers_result where label = 'hist0'), '2', 'janela 0: as 2 mensagens do lote são ignoradas');
select is((select r->>'reason' from pers_result where label = 'hist0'), 'history_disabled', 'janela 0: o motivo é "history_disabled"');
select is(
    (select count(*) from public.messages where external_message_id in ('ph-1', 'ph-2'))
    + (select count(*) from public.contacts where display_name in ('Histórico Zero')),
    0::bigint,
    'janela 0: nenhuma mensagem nem contato foi criado'
);

-- Janela de 7 dias: só entra o que está dentro dela
update public.channel_connections set history_window_days = 7 where id = 'b5000004-0000-4000-8000-000000000001';
insert into pers_result
select 'hist7', public.ingest_whatsapp_history_batch('pers-instance', jsonb_build_array(
    jsonb_build_object('external_message_id', 'ph-in', 'remote_jid', '5582988885003@s.whatsapp.net', 'from_me', false,
        'push_name', 'Dentro', 'text_content', 'há 5 dias', 'occurred_at', (now() - interval '5 days')),
    jsonb_build_object('external_message_id', 'ph-out', 'remote_jid', '5582988885004@s.whatsapp.net', 'from_me', false,
        'push_name', 'Fora', 'text_content', 'há 10 dias', 'occurred_at', (now() - interval '10 days'))
));
select is((select r->>'imported' from pers_result where label = 'hist7'), '1', 'janela 7: importa só a mensagem de 5 dias');
select is((select r->>'ignored' from pers_result where label = 'hist7'), '1', 'janela 7: ignora a de 10 dias');

-- ─── Entrada ao vivo: transmissão, canais e status ───────────────────────────────────────────────
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'bc-1', '5582988886001@broadcast', false, 'Lista', 'oi', now())->>'reason'),
    'broadcast_or_channel',
    'lista de transmissão com 12 dígitos NÃO vira telefone'
);
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'bc-2', '1234567890@broadcast', false, 'Lista', 'oi', now())->>'reason'),
    'broadcast_or_channel',
    'lista de transmissão com 10 dígitos NÃO vira telefone'
);
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'bc-3', '82988886003@broadcast', false, 'Lista', 'oi', now())->>'reason'),
    'broadcast_or_channel',
    'lista de transmissão com 11 dígitos NÃO vira telefone'
);
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'bc-4', 'status@broadcast', false, 'Status', 'oi', now())->>'reason'),
    'broadcast_or_channel',
    'Status do WhatsApp é ignorado'
);
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'bc-5', '120363000000000001@newsletter', false, 'Canal', 'oi', now())->>'reason'),
    'broadcast_or_channel',
    'canal (newsletter) é ignorado'
);
select is(
    (select count(*) from public.messages where external_message_id like 'bc-%')
    + (select count(*) from public.contact_points where normalized_value in ('+558288886001', '+551234567890', '+5582988886003')),
    0::bigint,
    'nada de transmissão/canal/status é gravado'
);

-- ─── Grupos: desligados por padrão ───────────────────────────────────────────────────────────────
select is(
    (select public.ingest_whatsapp_group_text_message('pers-instance', 'g-1', '120363005000000001@g.us', '5582988887001@s.whatsapp.net', false, 'Grupo da Família', 'Tia', 'oi pessoal', now())->>'reason'),
    'groups_disabled',
    'grupo é ignorado por padrão'
);
select is(
    (select count(*) from public.conversations where external_thread_id = '120363005000000001@g.us')
    + (select count(*) from public.messages where external_message_id = 'g-1')
    + (select count(*) from public.contact_points where normalized_value = '+5582988887001'),
    0::bigint,
    'grupo desligado: nenhuma conversa, mensagem nem contato de participante é criado'
);
select is(
    (select public.ingest_whatsapp_group_text_message('pers-instance', 'g-2', '120363005000000001@g.us', '', true, 'Grupo da Família', '', 'mensagem minha', now())->>'status'),
    'ignored',
    'grupo desligado: mensagem enviada por mim também é ignorada'
);
select is(
    (select (ignored_counts->>'group')::int from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'),
    2,
    'o contador agregado de grupos soma as 2 mensagens ignoradas'
);

-- Liberando grupos (chave ligada): volta a gravar, restrito ao dono como sempre
update public.channel_connections set ingest_groups = true where id = 'b5000004-0000-4000-8000-000000000001';
select is(
    (select public.ingest_whatsapp_group_text_message('pers-instance', 'g-3', '120363005000000002@g.us', '5582988887002@s.whatsapp.net', false, 'Grupo Liberado', 'Colega', 'oi', now())->>'status'),
    'success',
    'grupos ligados: a mensagem é gravada'
);
select is(
    (select visibility from public.conversations where external_thread_id = '120363005000000002@g.us'),
    'owner_only',
    'grupos ligados: a conversa continua restrita ao dono até ser liberada'
);
update public.channel_connections set ingest_groups = false where id = 'b5000004-0000-4000-8000-000000000001';

-- Mensagem de histórico de grupo também respeita a chave
select is(
    (select public.ingest_whatsapp_history_batch('pers-instance', jsonb_build_array(
        jsonb_build_object('external_message_id', 'hg-1', 'remote_jid', '120363005000000003@g.us', 'sender_jid', '5582988887003@s.whatsapp.net',
            'from_me', false, 'push_name', 'Membro', 'group_subject', 'Grupo Hist', 'text_content', 'x', 'occurred_at', (now() - interval '1 day'))
    ))->>'imported'),
    '0',
    'histórico de grupo não é importado com a chave desligada (e a janela 0 já descarta o lote)'
);

-- ─── Modo "só números cadastrados" ──────────────────────────────────────────────────────────────
-- Ligado
update public.channel_connections set ingest_only_known_contacts = true where id = 'b5000004-0000-4000-8000-000000000001';

select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-1', '5582988881001@s.whatsapp.net', false, 'Desconhecido', 'oi, sou novo', now())->>'reason'),
    'unknown_contact',
    'modo ligado: número desconhecido que ESCREVE para mim é ignorado'
);
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-2', '5582988881002@s.whatsapp.net', true, '', 'mensagem que EU enviei pelo celular', now())->>'reason'),
    'unknown_contact',
    'modo ligado: número desconhecido para quem EU escrevo (fromMe) é ignorado'
);
select is(
    (select count(*) from public.messages where external_message_id in ('k-1', 'k-2'))
    + (select count(*) from public.contact_points where normalized_value in ('+5582988881001', '+5582988881002'))
    + (select count(*) from public.contacts where display_name in ('Desconhecido', 'Contato +5582988881002'))
    + (select count(*) from public.conversations where external_thread_id in ('5582988881001@s.whatsapp.net', '5582988881002@s.whatsapp.net')),
    0::bigint,
    'modo ligado: desconhecido não cria contato, ponto de contato, conversa nem mensagem'
);

-- Contatos cadastrados
insert into public.contacts (id, workspace_id, display_name, classification, operational_status)
values
    ('b5000005-0000-4000-8000-000000000001', 'b5000002-0000-4000-8000-000000000001', 'Cadastrado Exato', 'lead', 'active'),
    ('b5000005-0000-4000-8000-000000000002', 'b5000002-0000-4000-8000-000000000001', 'Cadastrado Com Nove', 'lead', 'active'),
    ('b5000005-0000-4000-8000-000000000003', 'b5000002-0000-4000-8000-000000000001', 'Cadastrado Sem Nove', 'lead', 'active'),
    ('b5000005-0000-4000-8000-000000000004', 'b5000002-0000-4000-8000-000000000001', 'Cadastrado Gringo', 'lead', 'active');
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
values
    ('b5000006-0000-4000-8000-000000000001', 'b5000002-0000-4000-8000-000000000001', 'b5000005-0000-4000-8000-000000000001', 'phone', '+5582988882001', '(82) 98888-2001', 'active'),
    ('b5000006-0000-4000-8000-000000000002', 'b5000002-0000-4000-8000-000000000001', 'b5000005-0000-4000-8000-000000000002', 'phone', '+5582988882002', '(82) 98888-2002', 'active'),
    ('b5000006-0000-4000-8000-000000000003', 'b5000002-0000-4000-8000-000000000001', 'b5000005-0000-4000-8000-000000000003', 'phone', '+558288882003', '(82) 8888-2003', 'active'),
    ('b5000006-0000-4000-8000-000000000004', 'b5000002-0000-4000-8000-000000000001', 'b5000005-0000-4000-8000-000000000004', 'phone', '+14155550123', '+1 415 555 0123', 'active');

select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-3', '5582988882001@s.whatsapp.net', false, 'Nome do WhatsApp', 'sou cadastrado', now())->>'status'),
    'success',
    'modo ligado: número cadastrado é aceito'
);
select is(
    (select contact_id::text from public.messages m join public.conversations c on c.id = m.conversation_id
       join public.conversation_participants cp on cp.conversation_id = c.id
       join public.contact_points p on p.id = cp.contact_point_id where m.external_message_id = 'k-3'),
    'b5000005-0000-4000-8000-000000000001',
    'modo ligado: a mensagem vai para o contato cadastrado'
);
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-4', '5582988882001@s.whatsapp.net', true, '', 'respondi pelo celular', now())->>'status'),
    'success',
    'modo ligado: mensagem enviada por mim para número cadastrado é aceita'
);
-- 9º dígito: contato salvo COM o 9, o WhatsApp entrega o jid SEM o 9
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-5', '558288882002@s.whatsapp.net', false, 'Sem Nove', 'oi', now())->>'status'),
    'success',
    'modo ligado: contato salvo com 9º dígito casa com o jid sem o 9'
);
select is(
    (select count(*) from public.contact_points where contact_id = 'b5000005-0000-4000-8000-000000000002'),
    1::bigint,
    'modo ligado: a variante do 9º dígito reaproveita o contato existente (sem duplicar)'
);
select is(
    (select count(*) from public.contact_points where normalized_value = '+558288882002'),
    0::bigint,
    'modo ligado: a variante sem o 9 não vira um segundo ponto de contato'
);
-- 9º dígito: contato salvo SEM o 9, o jid vem COM o 9
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-6', '5582988882003@s.whatsapp.net', false, 'Com Nove', 'oi', now())->>'status'),
    'success',
    'modo ligado: contato salvo sem 9º dígito casa com o jid com o 9'
);
select is(
    (select count(*) from public.contact_points where normalized_value = '+5582988882003'),
    0::bigint,
    'modo ligado: o jid com 9 não cria um segundo ponto para o contato salvo sem 9'
);
-- Internacional: casa exato
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-7', '14155550123@s.whatsapp.net', false, 'Gringo', 'hi', now())->>'status'),
    'success',
    'modo ligado: número internacional cadastrado é aceito'
);
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-8', '14155550999@s.whatsapp.net', false, 'Outro Gringo', 'hi', now())->>'reason'),
    'unknown_contact',
    'modo ligado: número internacional não cadastrado é ignorado'
);
-- Ponto de contato sem contato (participante de grupo antigo) não conta como cadastrado
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
values ('b5000006-0000-4000-8000-000000000005', 'b5000002-0000-4000-8000-000000000001', null, 'phone', '+5582988883001', '(82) 98888-3001', 'active');
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-9', '5582988883001@s.whatsapp.net', false, 'Ex-participante', 'oi', now())->>'reason'),
    'unknown_contact',
    'modo ligado: participante de grupo sem cadastro em Contatos continua desconhecido'
);
-- Contato arquivado conta como desconhecido
update public.contacts set archived_at = now() where id = 'b5000005-0000-4000-8000-000000000004';
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-10', '14155550123@s.whatsapp.net', false, 'Gringo', 'hi de novo', now())->>'reason'),
    'unknown_contact',
    'modo ligado: contato ARQUIVADO volta a ser tratado como desconhecido'
);
-- Mensagem repetida de contato conhecido continua "duplicate"
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-3', '5582988882001@s.whatsapp.net', false, 'Nome do WhatsApp', 'sou cadastrado', now())->>'status'),
    'duplicate',
    'modo ligado: reentrega da mesma mensagem continua sendo duplicada'
);
-- Contadores agregados, sem número nem conteúdo
select results_eq(
    $$select (ignored_counts->>'unknown_contact')::int from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'$$,
    $$values (5)$$,
    'o contador agregado soma os 5 desconhecidos ignorados'
);
select ok(
    (select ignored_counts::text !~ '[0-9]{8,}' and ignored_counts::text !~ 'oi|sou' from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'),
    'o contador guarda só números pequenos por motivo (sem telefone nem texto)'
);
-- Identificador @lid (WhatsApp novo, sem telefone real): com o modo ligado é desconhecido e não grava nada
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'lid-1', '218943875198110@lid', false, 'Lid', 'oi', now())->>'reason'),
    'unknown_contact',
    'modo ligado: identificador @lid nunca vira contato com telefone falso'
);
select is(
    (select count(*) from public.contact_points where normalized_value like '+218943875198110%'),
    0::bigint,
    'modo ligado: nenhum ponto de contato foi criado para o @lid'
);
-- Número curto demais não é telefone: ignorado e contado
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'inv-1', '123@s.whatsapp.net', false, 'Curto', 'oi', now())->>'reason'),
    'invalid_phone',
    'número curto demais continua ignorado como telefone inválido'
);
select is(
    (select (ignored_counts->>'invalid_phone')::int from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'),
    1,
    'o telefone inválido aparece no contador "invalid_phone"'
);

-- Desligando o modo, o comportamento anterior volta (contato novo é criado)
update public.channel_connections set ingest_only_known_contacts = false where id = 'b5000004-0000-4000-8000-000000000001';
select is(
    (select public.ingest_whatsapp_text_message('pers-instance', 'k-11', '5582988884001@s.whatsapp.net', false, 'Lead Novo', 'quero comprar', now())->>'status'),
    'success',
    'modo desligado: número desconhecido cria contato como antes (leads novos)'
);
select is(
    (select count(*) from public.contacts where display_name = 'Lead Novo'),
    1::bigint,
    'modo desligado: o contato do lead novo foi criado'
);

-- ─── Tela de configuração: update_whatsapp_ingest_settings ─────────────────────────────────────────────
-- A conexão deste teste já está pareada (active). Cria uma ainda não pareada num segundo workspace para a janela.
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000002';
select throws_ok(
    $$select public.update_whatsapp_ingest_settings(true, null, null)$$,
    '42501', 'whatsapp_settings_not_authorized',
    'ATTENDANT não altera as chaves'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select is(
    (select public.update_whatsapp_ingest_settings(true, true, null)->>'status'),
    'success',
    'OWNER liga grupos e o modo "só cadastrados"'
);
reset role;
select results_eq(
    $$select ingest_groups, ingest_only_known_contacts from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'$$,
    $$values (true, true)$$,
    'as duas chaves foram gravadas'
);
select is(
    (select count(*) from public.audit_events where action = 'whatsapp.ingest_settings_changed' and actor_member_id = 'b5000003-0000-4000-8000-000000000001'),
    1::bigint,
    'a alteração gerou um evento de auditoria'
);
select ok(
    (select metadata::text like '%ingest_groups%' and metadata::text like '%ingest_only_known_contacts%'
        and metadata::text not like '%5582%'
       from public.audit_events where action = 'whatsapp.ingest_settings_changed' limit 1),
    'a auditoria registra quais chaves mudaram, sem dados de clientes'
);
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select is(
    (select public.update_whatsapp_ingest_settings(true, true, null)->>'changed'),
    'false',
    'repetir o mesmo valor não muda nada'
);
reset role;
select is(
    (select count(*) from public.audit_events where action = 'whatsapp.ingest_settings_changed'),
    1::bigint,
    'sem mudança real, nenhum novo evento de auditoria'
);
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select is(
    (select public.update_whatsapp_ingest_settings(null, false, null)->>'changed'),
    'true',
    'parâmetro nulo mantém o valor; false desliga só o modo'
);
reset role;
select results_eq(
    $$select ingest_groups, ingest_only_known_contacts from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'$$,
    $$values (true, false)$$,
    'só o modo foi desligado, grupos continuam ligados'
);
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select throws_ok(
    $$select public.update_whatsapp_ingest_settings(null, null, 3)$$,
    '55000', 'whatsapp_history_window_locked',
    'a janela de histórico não muda depois do pareamento'
);
select throws_ok(
    $$select public.update_whatsapp_ingest_settings(null, null, 16)$$,
    '22023', 'invalid_whatsapp_history_window',
    'janela fora de 0 a 15 é recusada'
);
reset role;

-- Conexão não pareada: a janela ainda pode ser escolhida
update public.channel_connections
set status = 'replaced', disconnected_at = now()
where id = 'b5000004-0000-4000-8000-000000000001';
insert into public.channel_connections (id, workspace_id, provider, external_account_id, status)
values ('b5000004-0000-4000-8000-000000000003', 'b5000002-0000-4000-8000-000000000001', 'whatsapp', 'pers-instance-new', 'configured');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select is(
    (select public.update_whatsapp_ingest_settings(null, null, 0)->>'status'),
    'success',
    'antes do pareamento o OWNER pode escolher a janela de histórico'
);
reset role;
select is(
    (select history_window_days::int from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000003'),
    0,
    'a janela escolhida fica gravada na conexão atual (a mais recente não substituída)'
);

-- Sem conexão, a função avisa
update public.channel_connections set status = 'replaced', disconnected_at = now() where id = 'b5000004-0000-4000-8000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select throws_ok(
    $$select public.update_whatsapp_ingest_settings(true, null, null)$$,
    'P0002', 'whatsapp_channel_not_found',
    'sem conexão registrada, a função pede para conectar primeiro'
);
reset role;

-- ─── Migração dos dados existentes: conexão nunca pareada ─────────────────────────────────────────────
-- (o comando da migration já rodou; aqui só confirma que conexões criadas depois seguem o padrão)
select is(
    (select count(*) from public.channel_connections where history_window_days not between 0 and 15),
    0::bigint,
    'nenhuma conexão tem janela fora do intervalo'
);

-- ─── Registro da conexão devolve a janela (o app decide se assina o histórico) ─────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select is(
    (select public.register_whatsapp_channel('pers-register-test')->>'history_window_days'),
    '15',
    'conexão nova registrada pelo app nasce com a janela padrão (15) e o registro a devolve'
);
reset role;
update public.channel_connections set history_window_days = 0 where external_account_id = 'pers-register-test';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5000000-0000-4000-8000-000000000001';
select is(
    (select public.register_whatsapp_channel('pers-register-test')->>'history_window_days'),
    '0',
    'registrar de novo uma conexão com histórico desligado devolve 0'
);
reset role;

-- ─── Conexão inexistente nunca quebra o webhook para telefone inválido ───────────────────────────────
select is(
    (select public.ingest_whatsapp_text_message('instancia-que-nao-existe', 'x-1', '123@s.whatsapp.net', false, '', 'oi', now())->>'reason'),
    'invalid_phone',
    'telefone inválido em instância desconhecida continua só "ignorado"'
);

-- ─── Dados existentes: conexão nunca pareada recebe os padrões do número pessoal ─────────────────────────────
-- (a migration roda o comando abaixo uma vez sobre as linhas que já existiam; aqui o mesmo comando é aplicado
-- a três linhas de teste: nunca pareada, já com histórico e ativa)
insert into public.channel_connections (id, workspace_id, provider, external_account_id, status, history_import_status)
values
    ('b5000004-0000-4000-8000-0000000000a1', 'b5000002-0000-4000-8000-000000000001', 'whatsapp', 'pers-never-paired', 'configured', null),
    ('b5000004-0000-4000-8000-0000000000a2', 'b5000002-0000-4000-8000-000000000001', 'whatsapp', 'pers-had-history', 'configured', 'completed');
update public.channel_connections
set history_window_days = 0,
    ingest_only_known_contacts = true
where provider = 'whatsapp'
  and status = 'configured'
  and activated_at is null
  and history_import_status is null
  and external_account_id in ('pers-never-paired', 'pers-had-history');
select results_eq(
    $$select history_window_days::int, ingest_groups, ingest_only_known_contacts from public.channel_connections where external_account_id = 'pers-never-paired'$$,
    $$values (0, false, true)$$,
    'conexão nunca pareada: histórico 0, grupos desligados, modo "só cadastrados" ligado'
);
select results_eq(
    $$select history_window_days::int, ingest_groups, ingest_only_known_contacts from public.channel_connections where external_account_id = 'pers-had-history'$$,
    $$values (15, false, false)$$,
    'conexão que já importou histórico não é tocada'
);
select results_eq(
    $$select history_window_days::int, ingest_only_known_contacts from public.channel_connections where id = 'b5000004-0000-4000-8000-000000000001'$$,
    $$values (7, false)$$,
    'conexão já pareada (as demais) não é tocada'
);

select * from finish();
rollback;
