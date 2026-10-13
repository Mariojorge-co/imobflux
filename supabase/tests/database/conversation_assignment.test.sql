begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(36);

-- ─── Fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
    ('b5200000-0000-4000-8000-000000000001', 'as-owner@example.test'),
    ('b5200000-0000-4000-8000-000000000002', 'as-a@example.test'),
    ('b5200000-0000-4000-8000-000000000003', 'as-b@example.test'),
    ('b5200000-0000-4000-8000-000000000004', 'as-s@example.test'),
    ('b5200000-0000-4000-8000-000000000009', 'as-other-owner@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5200001-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001', 'AS Owner', 'active'),
    ('b5200001-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002', 'AS Atendente A', 'active'),
    ('b5200001-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000003', 'AS Atendente B', 'active'),
    ('b5200001-0000-4000-8000-000000000004', 'b5200000-0000-4000-8000-000000000004', 'AS Suspenso S', 'active'),
    ('b5200001-0000-4000-8000-000000000009', 'b5200000-0000-4000-8000-000000000009', 'AS Outro Owner', 'active');

insert into public.workspaces (id, name, status, timezone)
values
    ('b5200002-0000-4000-8000-000000000001', 'AS Workspace', 'active', 'America/Maceio'),
    ('b5200002-0000-4000-8000-000000000009', 'AS Outro Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, suspended_at, invited_by_member_id)
values
    ('b5200003-0000-4000-8000-000000000001', 'b5200002-0000-4000-8000-000000000001', 'b5200001-0000-4000-8000-000000000001', 'owner', 'active', now(), null, null),
    ('b5200003-0000-4000-8000-000000000002', 'b5200002-0000-4000-8000-000000000001', 'b5200001-0000-4000-8000-000000000002', 'attendant', 'active', now(), null, 'b5200003-0000-4000-8000-000000000001'),
    ('b5200003-0000-4000-8000-000000000003', 'b5200002-0000-4000-8000-000000000001', 'b5200001-0000-4000-8000-000000000003', 'attendant', 'active', now(), null, 'b5200003-0000-4000-8000-000000000001'),
    ('b5200003-0000-4000-8000-000000000004', 'b5200002-0000-4000-8000-000000000001', 'b5200001-0000-4000-8000-000000000004', 'attendant', 'suspended', now(), now(), 'b5200003-0000-4000-8000-000000000001'),
    ('b5200003-0000-4000-8000-000000000009', 'b5200002-0000-4000-8000-000000000009', 'b5200001-0000-4000-8000-000000000009', 'owner', 'active', now(), null, null);

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5200004-0000-4000-8000-000000000001', 'b5200002-0000-4000-8000-000000000001', 'whatsapp', 'as_instance', '+5582999905200', 'active', now());

-- Contato protegido (conversa privada)
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b5200005-0000-4000-8000-000000000002', 'b5200002-0000-4000-8000-000000000001', 'AS Protegido', 'lead', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b5200006-0000-4000-8000-000000000002', 'b5200002-0000-4000-8000-000000000001', 'b5200005-0000-4000-8000-000000000002', 'phone', '+5582977005200', '(82) 97700-5200', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');

select public.ingest_whatsapp_text_message('as_instance', 'as-c1', '5582988885200@s.whatsapp.net', false, 'Cliente Comercial', 'Oi', now());
select public.ingest_whatsapp_text_message('as_instance', 'as-priv', '5582977005200@s.whatsapp.net', false, 'Protegido', 'Sigilo', now());
select public.ingest_whatsapp_group_text_message('as_instance', 'as-grp', '120363005200000001@g.us', '5582988885201@s.whatsapp.net', false, 'Grupo AS', 'Membro', 'Oi grupo', now());

create temp table as_ids (k text primary key, id uuid);
grant all on as_ids to public;
insert into as_ids select 'c1', id from public.conversations where external_thread_id = '5582988885200@s.whatsapp.net';
insert into as_ids select 'priv', id from public.conversations where external_thread_id = '5582977005200@s.whatsapp.net';
insert into as_ids select 'grp', id from public.conversations where external_thread_id = '120363005200000001@g.us';

select is((select visibility from public.conversations where id = (select id from as_ids where k = 'priv')), 'owner_only', 'fixture: conversa do contato protegido é privada');
select is((select visibility from public.conversations where id = (select id from as_ids where k = 'grp')), 'owner_only', 'fixture: grupo nasce restrito ao OWNER');

-- ─── Permissões ──────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.assign_conversation(uuid,uuid)', 'execute')
    and pg_catalog.has_function_privilege('authenticated', 'public.unassign_conversation(uuid,uuid)', 'execute')
    and pg_catalog.has_function_privilege('authenticated', 'public.reassign_conversation(uuid,uuid,uuid)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.assign_conversation(uuid,uuid)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.reassign_conversation(uuid,uuid,uuid)', 'execute'),
    'as funções de atribuição são para authenticated e nunca para anon'
);

-- ─── ATTENDANT A atribui B e a si mesmo (mais de um responsável) ─────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000002';

select is(
    (select public.assign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000003')->>'status'),
    'assigned',
    'ATTENDANT atribui a conversa comercial a outro membro'
);
select is(
    (select public.assign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000003')->>'status'),
    'unchanged',
    'atribuir de novo ao mesmo membro não duplica'
);
select is(
    (select public.assign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000002')->>'status'),
    'assigned',
    'a conversa pode ter mais de um responsável (A também se atribui)'
);

reset role;
select results_eq(
    $$select member_id::text, assigned_by_member_id::text from public.conversation_assignments
      where conversation_id = (select id from as_ids where k = 'c1') and ended_at is null order by member_id$$,
    $$values ('b5200003-0000-4000-8000-000000000002'::text, 'b5200003-0000-4000-8000-000000000002'::text),
             ('b5200003-0000-4000-8000-000000000003'::text, 'b5200003-0000-4000-8000-000000000002'::text)$$,
    'duas atribuições ativas, com o autor registrado'
);
select is(
    (select count(*) from public.audit_events where action = 'conversation.assigned' and target_id = (select id from as_ids where k = 'c1')),
    2::bigint,
    'cada atribuição é auditada'
);
select is(
    (select metadata->>'member_id' from public.audit_events where action = 'conversation.assigned' and metadata->>'member_id' = 'b5200003-0000-4000-8000-000000000003'),
    'b5200003-0000-4000-8000-000000000003',
    'a auditoria guarda quem foi atribuído, sem conteúdo da conversa'
);
select is(
    (select visibility from public.conversations where id = (select id from as_ids where k = 'c1')),
    'commercial',
    'atribuir não altera a visibilidade da conversa'
);

-- ─── Regras de elegibilidade ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000002';

select throws_ok(
    $$select public.assign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000004')$$,
    '22023', 'assignee_not_active',
    'não atribui a membro suspenso'
);
select throws_ok(
    $$select public.assign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000009')$$,
    '22023', 'assignee_not_active',
    'não atribui a membro de outro workspace'
);
select throws_ok(
    $$select public.assign_conversation((select id from as_ids where k = 'priv'), 'b5200003-0000-4000-8000-000000000003')$$,
    '42501', 'conversation_not_available',
    'ATTENDANT não atribui conversa privada (contato protegido)'
);
select throws_ok(
    $$select public.assign_conversation((select id from as_ids where k = 'grp'), 'b5200003-0000-4000-8000-000000000003')$$,
    '42501', 'conversation_not_available',
    'ATTENDANT não atribui grupo não liberado'
);
select throws_ok(
    $$select public.assign_conversation('b5200009-0000-4000-8000-0000000000ff', 'b5200003-0000-4000-8000-000000000003')$$,
    '42501', 'conversation_not_available',
    'conversa inexistente: mesma resposta, sem vazar existência'
);

-- OWNER: pode atribuir OWNER a conversa privada; não pode atribuir ATTENDANT a ela
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000001';
select is(
    (select public.assign_conversation((select id from as_ids where k = 'priv'), 'b5200003-0000-4000-8000-000000000001')->>'status'),
    'assigned',
    'OWNER pode se atribuir a uma conversa privada'
);
select throws_ok(
    $$select public.assign_conversation((select id from as_ids where k = 'priv'), 'b5200003-0000-4000-8000-000000000003')$$,
    '22023', 'assignee_cannot_access_conversation',
    'atribuir ATTENDANT a conversa privada seria entregar trabalho que ele não pode ver: recusado'
);
select throws_ok(
    $$select public.assign_conversation((select id from as_ids where k = 'grp'), 'b5200003-0000-4000-8000-000000000002')$$,
    '22023', 'assignee_cannot_access_conversation',
    'idem para grupo ainda não liberado'
);

-- Outro workspace não toca nesta conversa
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000009';
select throws_ok(
    $$select public.assign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000009')$$,
    '42501', 'conversation_not_available',
    'OWNER de outro workspace não atribui conversa alheia'
);

-- ─── Leitura: respeita o acesso ───────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000003';
select is(
    (select jsonb_array_length(public.get_conversation_assignees((select id from as_ids where k = 'c1')))),
    2,
    'qualquer membro com acesso vê os responsáveis da conversa'
);
select is(
    (select string_agg(a->>'display_name', ',' order by a->>'display_name') from jsonb_array_elements(public.get_conversation_assignees((select id from as_ids where k = 'c1'))) a),
    'AS Atendente A,AS Atendente B',
    'com os nomes (para exibir na tela)'
);
select is(
    (select count(*) from public.conversation_assignments where conversation_id = (select id from as_ids where k = 'priv')),
    0::bigint,
    'ATTENDANT não enxerga atribuições de conversa privada (RLS)'
);
select is(
    (select jsonb_array_length(public.get_conversation_assignees((select id from as_ids where k = 'priv')))),
    0,
    'nem pelo leitor de responsáveis'
);

-- ─── Inbox: responsáveis, "minhas" e contagem ───────────────────────────────────────────────────
select is(
    (select (i->>'assigned_to_me')::boolean from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'conversation_id' = (select id::text from as_ids where k = 'c1')),
    true,
    'a lista marca as conversas atribuídas a mim'
);
select is(
    (select jsonb_array_length(i->'assignees') from jsonb_array_elements(public.get_conversations_inbox()->'items') i where i->>'conversation_id' = (select id::text from as_ids where k = 'c1')),
    2,
    'a lista traz os responsáveis de cada conversa'
);
select is(
    (select jsonb_array_length(public.get_conversations_inbox('mine')->'items')),
    1,
    'a visão "minhas" traz só as conversas atribuídas a mim'
);
select is(
    (public.get_conversations_inbox()->'counts'->>'mine')::int,
    1,
    'o contador "minhas" acompanha'
);

-- ─── Troca de responsável ─────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000002';
select throws_ok(
    $$select public.reassign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000001', 'b5200003-0000-4000-8000-000000000003')$$,
    '55000', 'assignment_not_found',
    'trocar quem não é responsável é recusado'
);
select throws_ok(
    $$select public.reassign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000002', 'b5200003-0000-4000-8000-000000000002')$$,
    '22023', 'assignment_invalid',
    'trocar para o mesmo membro é recusado'
);
select is(
    (select public.reassign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000002', 'b5200003-0000-4000-8000-000000000003')->>'status'),
    'reassigned',
    'troca A -> B (B já era responsável: só encerra a de A)'
);

reset role;
select results_eq(
    $$select (ended_at is not null), end_reason, ended_by_member_id::text from public.conversation_assignments
      where conversation_id = (select id from as_ids where k = 'c1') and member_id = 'b5200003-0000-4000-8000-000000000002'$$,
    $$values (true, 'reassigned'::text, 'b5200003-0000-4000-8000-000000000002'::text)$$,
    'a atribuição antiga é encerrada, mas preservada no histórico'
);
select is(
    (select count(*) from public.conversation_assignments where conversation_id = (select id from as_ids where k = 'c1') and ended_at is null),
    1::bigint,
    'resta uma atribuição ativa (B)'
);
select is(
    (select count(*) from public.audit_events where action in ('conversation.unassigned', 'conversation.assigned') and target_id = (select id from as_ids where k = 'c1') and metadata ? 'reason'),
    1::bigint,
    'a troca é auditada (encerramento com motivo "reassigned")'
);

-- ─── Remover responsável ──────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000003';
select throws_ok(
    $$select public.unassign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000002')$$,
    '55000', 'assignment_not_found',
    'remover quem não é responsável é recusado'
);
select is(
    (select public.unassign_conversation((select id from as_ids where k = 'c1'), 'b5200003-0000-4000-8000-000000000003')->>'status'),
    'unassigned',
    'um membro pode tirar a responsabilidade da conversa'
);
select is(
    (select jsonb_array_length(public.get_conversation_assignees((select id from as_ids where k = 'c1')))),
    0,
    'conversa fica sem responsável'
);

select * from finish();
rollback;
