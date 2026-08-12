begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(72);

insert into auth.users (id, email)
values
  ('a2400000-0000-4000-8000-000000000001', 'privacy-owner@example.test'),
  ('a2400000-0000-4000-8000-000000000002', 'privacy-attendant@example.test'),
  ('a2400000-0000-4000-8000-000000000003', 'privacy-other-owner@example.test');

insert into public.workspaces (id, name, status, timezone)
values
  ('a2400001-0000-4000-8000-000000000001', 'Privacy Workspace', 'active', 'America/Maceio'),
  ('a2400001-0000-4000-8000-000000000002', 'Other Privacy Workspace', 'active', 'America/Maceio');

insert into public.app_users (id, auth_user_id, display_name, status)
values
  ('a2400002-0000-4000-8000-000000000001', 'a2400000-0000-4000-8000-000000000001', 'Privacy Owner', 'active'),
  ('a2400002-0000-4000-8000-000000000002', 'a2400000-0000-4000-8000-000000000002', 'Privacy Attendant', 'active'),
  ('a2400002-0000-4000-8000-000000000003', 'a2400000-0000-4000-8000-000000000003', 'Other Privacy Owner', 'active');

insert into public.workspace_members (
  id, workspace_id, user_id, role, status, activated_at, invited_by_member_id
)
values
  ('a2400003-0000-4000-8000-000000000001', 'a2400001-0000-4000-8000-000000000001', 'a2400002-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
  ('a2400003-0000-4000-8000-000000000002', 'a2400001-0000-4000-8000-000000000001', 'a2400002-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'a2400003-0000-4000-8000-000000000001'),
  ('a2400003-0000-4000-8000-000000000003', 'a2400001-0000-4000-8000-000000000002', 'a2400002-0000-4000-8000-000000000003', 'owner', 'active', now(), null);

select public.provision_default_pipeline_stages('a2400001-0000-4000-8000-000000000001');

insert into public.channel_connections (
  id, workspace_id, provider, external_account_id, external_phone_normalized,
  status, activated_at
)
values (
  'a2400004-0000-4000-8000-000000000001',
  'a2400001-0000-4000-8000-000000000001',
  'whatsapp', 'privacy-account', '+5582999902400', 'active', now()
);

insert into public.contacts (
  id, workspace_id, display_name, classification, operational_status,
  is_protected, protected_at, commercial_visible_from, created_at, updated_at
)
values
  (
    'a2400005-0000-4000-8000-000000000001',
    'a2400001-0000-4000-8000-000000000001',
    'Contato Público', 'lead', 'active', false, null,
    now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours'
  ),
  (
    'a2400005-0000-4000-8000-000000000002',
    'a2400001-0000-4000-8000-000000000001',
    'Contato Privado', 'lead', 'active', true, now() - interval '1 hour',
    null, now() - interval '2 hours', now() - interval '2 hours'
  );

insert into public.contact_points (
  id, workspace_id, contact_id, point_type, normalized_value, display_value,
  external_display_name, operational_status, is_protected, protected_at,
  commercial_visible_from, created_at, updated_at
)
values
  (
    'a2400006-0000-4000-8000-000000000001',
    'a2400001-0000-4000-8000-000000000001',
    'a2400005-0000-4000-8000-000000000001', 'phone', '+5582999902401',
    '(82) 99990-2401', 'Público WhatsApp', 'active', false, null,
    now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours'
  ),
  (
    'a2400006-0000-4000-8000-000000000002',
    'a2400001-0000-4000-8000-000000000001',
    'a2400005-0000-4000-8000-000000000002', 'phone', '+5582999902402',
    '(82) 99990-2402', 'Privado WhatsApp', 'active', true, now() - interval '1 hour',
    null, now() - interval '2 hours', now() - interval '2 hours'
  );

insert into public.conversations (
  id, workspace_id, channel_connection_id, external_thread_id, conversation_type,
  operational_status, visibility, commercial_visible_from, subject, started_at,
  privacy_changed_at, created_at, updated_at
)
values
  (
    'a2400007-0000-4000-8000-000000000001',
    'a2400001-0000-4000-8000-000000000001',
    'a2400004-0000-4000-8000-000000000001', 'public@s.whatsapp.net',
    'individual', 'active', 'commercial', now() - interval '1 hour', null,
    now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours'
  ),
  (
    'a2400007-0000-4000-8000-000000000002',
    'a2400001-0000-4000-8000-000000000001',
    'a2400004-0000-4000-8000-000000000001', 'private@s.whatsapp.net',
    'individual', 'active', 'owner_only', null, null,
    now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours'
  ),
  (
    'a2400007-0000-4000-8000-000000000003',
    'a2400001-0000-4000-8000-000000000001',
    'a2400004-0000-4000-8000-000000000001', 'public-group@g.us',
    'group', 'active', 'commercial', now() - interval '1 hour', 'Grupo Liberado',
    now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours'
  ),
  (
    'a2400007-0000-4000-8000-000000000004',
    'a2400001-0000-4000-8000-000000000001',
    'a2400004-0000-4000-8000-000000000001', 'private-group@g.us',
    'group', 'active', 'owner_only', null, 'Grupo Privado',
    now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours'
  );

insert into public.conversation_participants (
  id, workspace_id, conversation_id, contact_point_id, external_display_name, first_seen_at
)
values
  ('a2400008-0000-4000-8000-000000000001', 'a2400001-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000001', 'a2400006-0000-4000-8000-000000000001', null, now() - interval '2 hours'),
  ('a2400008-0000-4000-8000-000000000002', 'a2400001-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000002', 'a2400006-0000-4000-8000-000000000002', null, now() - interval '2 hours'),
  ('a2400008-0000-4000-8000-000000000003', 'a2400001-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000003', 'a2400006-0000-4000-8000-000000000002', 'Maria no Grupo', now() - interval '2 hours'),
  ('a2400008-0000-4000-8000-000000000004', 'a2400001-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000004', 'a2400006-0000-4000-8000-000000000001', null, now() - interval '2 hours');

insert into public.messages (
  id, workspace_id, channel_connection_id, conversation_id, external_message_id,
  direction, origin, sender_contact_point_id, text_content, status,
  occurred_at, external_created_at, received_at, created_at
)
values
  ('a2400009-0000-4000-8000-000000000001', 'a2400001-0000-4000-8000-000000000001', 'a2400004-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000001', 'privacy-public-before', 'incoming', 'whatsapp', 'a2400006-0000-4000-8000-000000000001', 'Pública antes do corte', 'received', now() - interval '90 minutes', now() - interval '90 minutes', now(), now() - interval '90 minutes'),
  ('a2400009-0000-4000-8000-000000000002', 'a2400001-0000-4000-8000-000000000001', 'a2400004-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000001', 'privacy-public-after', 'incoming', 'whatsapp', 'a2400006-0000-4000-8000-000000000001', 'Pública após o corte', 'received', now() - interval '30 minutes', now() - interval '30 minutes', now(), now() - interval '30 minutes'),
  ('a2400009-0000-4000-8000-000000000003', 'a2400001-0000-4000-8000-000000000001', 'a2400004-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000002', 'privacy-private', 'incoming', 'whatsapp', 'a2400006-0000-4000-8000-000000000002', 'Mensagem privada', 'received', now() - interval '20 minutes', now() - interval '20 minutes', now(), now() - interval '20 minutes'),
  ('a2400009-0000-4000-8000-000000000004', 'a2400001-0000-4000-8000-000000000001', 'a2400004-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000003', 'privacy-group-before', 'incoming', 'whatsapp', 'a2400006-0000-4000-8000-000000000002', 'Grupo antes do corte', 'received', now() - interval '90 minutes', now() - interval '90 minutes', now(), now() - interval '90 minutes'),
  ('a2400009-0000-4000-8000-000000000005', 'a2400001-0000-4000-8000-000000000001', 'a2400004-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000003', 'privacy-group-after', 'incoming', 'whatsapp', 'a2400006-0000-4000-8000-000000000002', 'Grupo após o corte', 'received', now() - interval '15 minutes', now() - interval '15 minutes', now(), now() - interval '15 minutes');

insert into public.conversation_assignments (
  id, workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at
)
values (
  'a240000a-0000-4000-8000-000000000001',
  'a2400001-0000-4000-8000-000000000001',
  'a2400007-0000-4000-8000-000000000001',
  'a2400003-0000-4000-8000-000000000002',
  'a2400003-0000-4000-8000-000000000001',
  now() - interval '30 minutes'
);

insert into public.opportunities (
  id, workspace_id, contact_id, current_stage_id, title, status, created_at, updated_at
)
values
  ('a240000b-0000-4000-8000-000000000001', 'a2400001-0000-4000-8000-000000000001', 'a2400005-0000-4000-8000-000000000001', (select id from public.pipeline_stages where workspace_id = 'a2400001-0000-4000-8000-000000000001' order by position limit 1), 'Operação anterior', 'open', now() - interval '90 minutes', now() - interval '20 minutes'),
  ('a240000b-0000-4000-8000-000000000002', 'a2400001-0000-4000-8000-000000000001', 'a2400005-0000-4000-8000-000000000001', (select id from public.pipeline_stages where workspace_id = 'a2400001-0000-4000-8000-000000000001' order by position limit 1), 'Operação atual', 'open', now() - interval '20 minutes', now() - interval '20 minutes'),
  ('a240000b-0000-4000-8000-000000000003', 'a2400001-0000-4000-8000-000000000001', 'a2400005-0000-4000-8000-000000000002', (select id from public.pipeline_stages where workspace_id = 'a2400001-0000-4000-8000-000000000001' order by position limit 1), 'Operação privada', 'open', now() - interval '20 minutes', now() - interval '20 minutes');

set local role authenticated;
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';

select is((select member_role from private.active_member_context()), 'owner', 'OWNER has an active member context');
select is((select count(*) from public.contacts), 2::bigint, 'OWNER sees public and private contacts');
select is((select count(*) from public.conversations), 4::bigint, 'OWNER sees individual and group conversations regardless of privacy');
select is((select count(*) from public.messages), 5::bigint, 'OWNER sees messages before and after visibility cutoffs');
select is((select count(*) from public.opportunities), 3::bigint, 'OWNER sees historical and private opportunities');

set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';

select is((select member_role from private.active_member_context()), 'attendant', 'ATTENDANT has an active member context');
select results_eq('select display_name from public.contacts order by display_name', array['Contato Público'], 'ATTENDANT sees only the public contact');
select is((select count(*) from public.contacts where display_name ilike '%Privado%'), 0::bigint, 'contact search leaks no private result');
select results_eq(
  'select subject from public.conversations where conversation_type = ''group'' order by subject',
  array['Grupo Liberado'],
  'ATTENDANT sees only released groups'
);
select results_eq(
  'select text_content from public.messages order by text_content',
  array['Grupo após o corte', 'Pública após o corte'],
  'ATTENDANT sees only messages in the current authorized epochs'
);
select is((select count(*) from public.contact_points where id = 'a2400006-0000-4000-8000-000000000002'), 0::bigint, 'group access does not expose the private contact point');
select is((select count(*) from public.conversation_participants where conversation_id = 'a2400007-0000-4000-8000-000000000003'), 1::bigint, 'released group exposes its scoped participant representation');
select results_eq('select title from public.opportunities order by title', array['Operação atual'], 'historical and private opportunities remain hidden');
select is((public.get_conversations_inbox()->'counts'->>'all')::int, 2, 'Tudo counts authorized non-archived individual and group conversations');
select is((public.get_conversations_inbox()->'counts'->>'groups')::int, 1, 'group count includes only authorized non-archived groups');
select is((public.get_conversations_inbox()->'counts'->>'unread')::int, 2, 'unread count includes only authorized non-archived conversations');
select is(jsonb_array_length(public.get_conversation_messages('a2400007-0000-4000-8000-000000000001')->'messages'), 1, 'message read model starts at the current visibility epoch');
select is(public.get_conversation_context('a2400007-0000-4000-8000-000000000003')->'contact', 'null'::jsonb, 'group context never falls back to an unrelated CRM contact');
select is(jsonb_array_length(public.get_conversation_context('a2400007-0000-4000-8000-000000000001')->'all_opportunities'), 1, 'conversation context excludes opportunities from before the visibility epoch');

-- Colaboração real: OWNER e ATTENDANT alternam autoria sem assumir ownership da conversa.
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M1 OWNER', 'a2400010-0000-4000-8000-000000000001')$$, 'OWNER enfileira M1');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M2 ATTENDANT', 'a2400010-0000-4000-8000-000000000002')$$, 'ATTENDANT enfileira M2 depois do OWNER');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M3 OWNER', 'a2400010-0000-4000-8000-000000000003')$$, 'OWNER enfileira M3 depois do ATTENDANT');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M4 ATTENDANT', 'a2400010-0000-4000-8000-000000000004')$$, 'ATTENDANT enfileira M4 depois do OWNER');
select is((select count(*) from public.messages where text_content in ('M1 OWNER', 'M2 ATTENDANT', 'M3 OWNER', 'M4 ATTENDANT')), 4::bigint, 'primeira alternância persiste quatro mensagens');
select is((select count(distinct client_idempotency_key) from public.messages where text_content like 'M%'), 4::bigint, 'primeira alternância não duplica mensagens');
select results_eq(
  $$select internal_author_member_id from public.messages where text_content in ('M1 OWNER', 'M2 ATTENDANT', 'M3 OWNER', 'M4 ATTENDANT') order by occurred_at, text_content$$,
  array['a2400003-0000-4000-8000-000000000001','a2400003-0000-4000-8000-000000000002','a2400003-0000-4000-8000-000000000001','a2400003-0000-4000-8000-000000000002']::uuid[],
  'primeira alternância preserva sender_member_id em ordem'
);
select is((select text_content from public.messages where text_content like 'M% OWNER' or text_content like 'M% ATTENDANT' order by occurred_at desc, created_at desc limit 1), 'M4 ATTENDANT', 'preview autoritativo termina em M4');

select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M5 ATTENDANT', 'a2400010-0000-4000-8000-000000000005')$$, 'ATTENDANT inicia a sequência inversa');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M6 OWNER', 'a2400010-0000-4000-8000-000000000006')$$, 'OWNER responde na sequência inversa');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M7 ATTENDANT', 'a2400010-0000-4000-8000-000000000007')$$, 'ATTENDANT responde novamente');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select lives_ok($$select public.queue_outgoing_text_message('a2400007-0000-4000-8000-000000000001', 'M8 OWNER', 'a2400010-0000-4000-8000-000000000008')$$, 'OWNER encerra a sequência inversa');
select is((select count(*) from public.messages where text_content ~ '^M[1-8] '), 8::bigint, 'as duas sequências persistem oito mensagens sem perda');
select results_eq(
  $$select internal_author_member_id from public.messages where text_content in ('M5 ATTENDANT', 'M6 OWNER', 'M7 ATTENDANT', 'M8 OWNER') order by occurred_at, text_content$$,
  array['a2400003-0000-4000-8000-000000000002','a2400003-0000-4000-8000-000000000001','a2400003-0000-4000-8000-000000000002','a2400003-0000-4000-8000-000000000001']::uuid[],
  'sequência inversa preserva autoria correta'
);
select is((select text_content from public.messages where text_content ~ '^M[1-8] ' order by occurred_at desc, created_at desc limit 1), 'M8 OWNER', 'preview autoritativo termina em M8');

-- Notas inter-membros usam leitura autoritativa sem depender da listagem de equipe.
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select lives_ok($$select public.save_internal_note('a2400007-0000-4000-8000-000000000001', 'NOTA FUNCIONÁRIO', 'a240000b-0000-4000-8000-000000000002')$$, 'ATTENDANT salva nota autorizada');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select results_eq(
  $$select content || '|' || author_name from public.get_visible_internal_notes('a2400007-0000-4000-8000-000000000001', 'a240000b-0000-4000-8000-000000000002') where content = 'NOTA FUNCIONÁRIO'$$,
  array['NOTA FUNCIONÁRIO|Privacy Attendant'],
  'OWNER lê após reload a nota e autoria do ATTENDANT'
);
select lives_ok($$select public.save_internal_note('a2400007-0000-4000-8000-000000000001', 'NOTA OWNER', 'a240000b-0000-4000-8000-000000000002')$$, 'OWNER salva nota autorizada');
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select results_eq(
  $$select content || '|' || author_name from public.get_visible_internal_notes('a2400007-0000-4000-8000-000000000001', 'a240000b-0000-4000-8000-000000000002') where content in ('NOTA FUNCIONÁRIO', 'NOTA OWNER') order by content$$,
  array['NOTA FUNCIONÁRIO|Privacy Attendant','NOTA OWNER|Privacy Owner'],
  'ATTENDANT autorizado lê notas do ciclo com autoria correta'
);
select is((select count(*) from public.messages where text_content in ('NOTA FUNCIONÁRIO', 'NOTA OWNER')), 0::bigint, 'notas internas não criam outgoing messages');

-- Edição contextual altera apenas o nome CRM e confirma cadastro provisório.
reset role;
update public.contacts set registration_status = 'provisional' where id = 'a2400005-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select is(public.update_conversation_contact_name('a2400007-0000-4000-8000-000000000001', 'Nome CRM Atualizado')->>'display_name', 'Nome CRM Atualizado', 'ATTENDANT autorizado edita o nome no contexto da conversa');
select is((select registration_status from public.contacts where id = 'a2400005-0000-4000-8000-000000000001'), 'confirmed', 'salvar nome confirma contato provisório');
select is((select external_display_name from public.contact_points where id = 'a2400006-0000-4000-8000-000000000001'), 'Público WhatsApp', 'editar nome CRM preserva pushName externo');

-- Follow-ups incluem vencidos e todos os horários do dia, mas não dias futuros.
reset role;
insert into public.work_tasks (id, workspace_id, task_type, title, status, priority, due_at, contact_id, created_by_member_id)
values
  ('a2400011-0000-4000-8000-000000000001','a2400001-0000-4000-8000-000000000001','follow_up','Ontem','pending','normal',(((now() at time zone 'America/Sao_Paulo')::date - 1 + time '08:00') at time zone 'America/Sao_Paulo'),'a2400005-0000-4000-8000-000000000001','a2400003-0000-4000-8000-000000000001'),
  ('a2400011-0000-4000-8000-000000000002','a2400001-0000-4000-8000-000000000001','follow_up','Hoje vencido','pending','normal',(now() - interval '2 hours'),'a2400005-0000-4000-8000-000000000001','a2400003-0000-4000-8000-000000000001'),
  ('a2400011-0000-4000-8000-000000000003','a2400001-0000-4000-8000-000000000001','follow_up','Hoje futuro','pending','normal',(((now() at time zone 'America/Sao_Paulo')::date + time '23:59') at time zone 'America/Sao_Paulo'),'a2400005-0000-4000-8000-000000000001','a2400003-0000-4000-8000-000000000001'),
  ('a2400011-0000-4000-8000-000000000004','a2400001-0000-4000-8000-000000000001','follow_up','Amanhã','pending','normal',(((now() at time zone 'America/Sao_Paulo')::date + 1 + time '08:00') at time zone 'America/Sao_Paulo'),'a2400005-0000-4000-8000-000000000001','a2400003-0000-4000-8000-000000000001');
set local role authenticated;
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select is(jsonb_array_length(public.get_prioridades_dashboard()->'due_followups'), 3, 'prioridades inclui ontem e todos os follow-ups de hoje');
select is((select count(*) from jsonb_array_elements(public.get_prioridades_dashboard()->'due_followups') item where item->>'title' = 'Amanhã'), 0::bigint, 'prioridades exclui follow-up de dia futuro');
select results_eq(
  $$select item->>'title' from jsonb_array_elements(public.get_prioridades_dashboard()->'due_followups') with ordinality as row(item, position) order by position$$,
  array['Ontem','Hoje vencido','Hoje futuro'],
  'follow-ups ordenam vencidos mais antigos antes do horário futuro de hoje'
);
select lives_ok($$select public.complete_work_task('a2400011-0000-4000-8000-000000000001')$$, 'concluir follow-up persiste sem alterar Kanban');
select is(jsonb_array_length(public.get_prioridades_dashboard()->'due_followups'), 2, 'follow-up concluído desaparece de Prioridades');
select lives_ok($$select public.upsert_work_task('follow_up','Hoje vencido',(((now() at time zone 'America/Sao_Paulo')::date + 1 + time '09:00') at time zone 'America/Sao_Paulo'),null,null,null,'a2400011-0000-4000-8000-000000000002')$$, 'reagendar follow-up para amanhã persiste');
select is(jsonb_array_length(public.get_prioridades_dashboard()->'due_followups'), 1, 'reagendar para amanhã remove da fila de hoje');
select lives_ok($$select public.upsert_work_task('follow_up','Amanhã',(((now() at time zone 'America/Sao_Paulo')::date + time '22:00') at time zone 'America/Sao_Paulo'),null,null,null,'a2400011-0000-4000-8000-000000000004')$$, 'reagendar para hoje persiste');
select is(jsonb_array_length(public.get_prioridades_dashboard()->'due_followups'), 2, 'reagendar para hoje mantém na fila diária');

set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select lives_ok($$select public.mark_conversation_unread('a2400007-0000-4000-8000-000000000001', true)$$, 'ATTENDANT can mark an authorized conversation unread');
select throws_ok(
  $$select public.mark_conversation_unread('a2400007-0000-4000-8000-000000000002', true)$$,
  '42501', 'conversation_not_available',
  'ATTENDANT cannot mutate read state for a private conversation'
);
select is(public.set_conversation_archived('a2400007-0000-4000-8000-000000000001', true)->>'archived', 'true', 'authorized member can archive a conversation');
select is((public.get_conversations_inbox()->'counts'->>'unread')::int, 1, 'archived unread conversation is excluded from the main unread count');
select is((public.get_conversations_inbox()->'counts'->>'archived_unread')::int, 1, 'archived unread conversation has its own count');

set local role service_role;
select public.ingest_whatsapp_text_message(
  'privacy-account', 'privacy-archived-new', 'public@s.whatsapp.net', false,
  'Público WhatsApp', 'Mensagem nova arquivada', now()
);
set local role authenticated;
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select ok((select archived_at is not null from public.conversations where id = 'a2400007-0000-4000-8000-000000000001'), 'new incoming message does not unarchive a conversation');
select is(public.set_conversation_archived('a2400007-0000-4000-8000-000000000001', false)->>'archived', 'false', 'unarchive remains an explicit manual action');
select throws_ok(
  $$insert into public.conversation_read_states (workspace_id, conversation_id, member_id) values ('a2400001-0000-4000-8000-000000000001', 'a2400007-0000-4000-8000-000000000001', 'a2400003-0000-4000-8000-000000000001')$$,
  '42501', null,
  'direct read-state writes remain denied'
);
select throws_ok(
  $$select public.set_contact_team_visibility('a2400005-0000-4000-8000-000000000001', false)$$,
  '42501', 'contact_visibility_not_authorized',
  'ATTENDANT cannot change contact privacy'
);
select throws_ok(
  $$select public.set_group_team_visibility('a2400007-0000-4000-8000-000000000003', false)$$,
  '42501', 'group_visibility_not_authorized',
  'ATTENDANT cannot change group privacy'
);

set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';

select is(
  public.set_contact_team_visibility('a2400005-0000-4000-8000-000000000001', false)->>'team_visible',
  'false',
  'OWNER can make a contact owner-only'
);
select ok((select ended_at is not null from public.conversation_assignments where id = 'a240000a-0000-4000-8000-000000000001'), 'protecting a contact ends active ATTENDANT assignments');
select ok(exists(select 1 from public.audit_events where action = 'contact.owner_only_enabled' and target_id = 'a2400005-0000-4000-8000-000000000001'), 'contact protection creates an audit event');

set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select is((select count(*) from public.contacts), 0::bigint, 'protection immediately removes the contact from ATTENDANT reads');
select is((select count(*) from public.messages where conversation_id = 'a2400007-0000-4000-8000-000000000001'), 0::bigint, 'protection immediately removes individual message history');

set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select is(
  public.set_contact_team_visibility('a2400005-0000-4000-8000-000000000001', true)->>'team_visible',
  'true',
  'OWNER can start a new public visibility epoch'
);

reset role;

insert into public.messages (
  id, workspace_id, channel_connection_id, conversation_id, external_message_id,
  direction, origin, sender_contact_point_id, text_content, status,
  occurred_at, external_created_at, received_at, created_at
)
values (
  'a2400009-0000-4000-8000-000000000006',
  'a2400001-0000-4000-8000-000000000001',
  'a2400004-0000-4000-8000-000000000001',
  'a2400007-0000-4000-8000-000000000001',
  'privacy-new-epoch', 'incoming', 'whatsapp',
  'a2400006-0000-4000-8000-000000000001', 'Mensagem do novo ciclo',
  'received',
  (select commercial_visible_from + interval '1 second'
     from public.contacts where id = 'a2400005-0000-4000-8000-000000000001'),
  (select commercial_visible_from + interval '1 second'
     from public.contacts where id = 'a2400005-0000-4000-8000-000000000001'),
  clock_timestamp(), clock_timestamp()
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select results_eq(
  'select text_content from public.messages where conversation_id = ''a2400007-0000-4000-8000-000000000001'' order by text_content',
  array['Mensagem do novo ciclo'],
  'a new visibility epoch does not reopen messages from prior epochs'
);
select is((select count(*) from public.opportunities), 0::bigint, 'a new epoch does not reopen earlier opportunities');

set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000001';
select is(
  public.set_group_team_visibility('a2400007-0000-4000-8000-000000000003', false)->>'team_visible',
  'false',
  'OWNER can make a group owner-only'
);
select ok(exists(select 1 from public.audit_events where action = 'group.owner_only_enabled' and target_id = 'a2400007-0000-4000-8000-000000000003'), 'group privacy change creates an audit event');

set local "request.jwt.claim.sub" = 'a2400000-0000-4000-8000-000000000002';
select is((select count(*) from public.conversations where conversation_type = 'group'), 0::bigint, 'restricted groups disappear completely for ATTENDANT');

select * from finish();
rollback;
