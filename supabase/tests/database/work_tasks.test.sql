begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(43);

-- ─── Fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
    ('b5400000-0000-4000-8000-000000000001', 'tk-owner@example.test'),
    ('b5400000-0000-4000-8000-000000000002', 'tk-a@example.test'),
    ('b5400000-0000-4000-8000-000000000003', 'tk-b@example.test'),
    ('b5400000-0000-4000-8000-000000000004', 'tk-s@example.test'),
    ('b5400000-0000-4000-8000-000000000009', 'tk-other-owner@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5400001-0000-4000-8000-000000000001', 'b5400000-0000-4000-8000-000000000001', 'TK Owner', 'active'),
    ('b5400001-0000-4000-8000-000000000002', 'b5400000-0000-4000-8000-000000000002', 'TK Atendente A', 'active'),
    ('b5400001-0000-4000-8000-000000000003', 'b5400000-0000-4000-8000-000000000003', 'TK Atendente B', 'active'),
    ('b5400001-0000-4000-8000-000000000004', 'b5400000-0000-4000-8000-000000000004', 'TK Suspenso', 'active'),
    ('b5400001-0000-4000-8000-000000000009', 'b5400000-0000-4000-8000-000000000009', 'TK Outro Owner', 'active');

insert into public.workspaces (id, name, status, timezone)
values
    ('b5400002-0000-4000-8000-000000000001', 'TK Workspace', 'active', 'America/Maceio'),
    ('b5400002-0000-4000-8000-000000000009', 'TK Outro Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, suspended_at, invited_by_member_id)
values
    ('b5400003-0000-4000-8000-000000000001', 'b5400002-0000-4000-8000-000000000001', 'b5400001-0000-4000-8000-000000000001', 'owner', 'active', now(), null, null),
    ('b5400003-0000-4000-8000-000000000002', 'b5400002-0000-4000-8000-000000000001', 'b5400001-0000-4000-8000-000000000002', 'attendant', 'active', now(), null, 'b5400003-0000-4000-8000-000000000001'),
    ('b5400003-0000-4000-8000-000000000003', 'b5400002-0000-4000-8000-000000000001', 'b5400001-0000-4000-8000-000000000003', 'attendant', 'active', now(), null, 'b5400003-0000-4000-8000-000000000001'),
    ('b5400003-0000-4000-8000-000000000004', 'b5400002-0000-4000-8000-000000000001', 'b5400001-0000-4000-8000-000000000004', 'attendant', 'suspended', now(), now(), 'b5400003-0000-4000-8000-000000000001'),
    ('b5400003-0000-4000-8000-000000000009', 'b5400002-0000-4000-8000-000000000009', 'b5400001-0000-4000-8000-000000000009', 'owner', 'active', now(), null, null);

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5400004-0000-4000-8000-000000000001', 'b5400002-0000-4000-8000-000000000001', 'whatsapp', 'tk_instance', '+5582999905400', 'active', now());

insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values ('b5400005-0000-4000-8000-000000000001', 'b5400002-0000-4000-8000-000000000001', 'TK Etapa', 1, true, 'prospecting');

-- Contato protegido (tarefas dele são privadas)
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b5400006-0000-4000-8000-000000000002', 'b5400002-0000-4000-8000-000000000001', 'TK Protegido', 'lead', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');

select public.ingest_whatsapp_text_message('tk_instance', 'tk-c1', '5582988885400@s.whatsapp.net', false, 'Cliente TK', 'Oi', now());

create temp table tk_ids (k text primary key, id uuid);
grant all on tk_ids to public;
insert into tk_ids select 'contact', c.id from public.contacts c where c.display_name = 'Cliente TK';
insert into tk_ids select 'conv', id from public.conversations where external_thread_id = '5582988885400@s.whatsapp.net';
insert into tk_ids values ('prot', 'b5400006-0000-4000-8000-000000000002');

insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status)
select 'b5400007-0000-4000-8000-000000000001', c.workspace_id, c.id, 'b5400005-0000-4000-8000-000000000001', 'TK Opp', 'open'
from public.contacts c where c.display_name = 'Cliente TK';
insert into tk_ids values ('opp', 'b5400007-0000-4000-8000-000000000001');

-- ─── Permissões ──────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.create_work_task(text,text,timestamptz,text,uuid,text,timestamptz,uuid,uuid,uuid)', 'execute')
    and pg_catalog.has_function_privilege('authenticated', 'public.update_work_task(uuid,text,timestamptz,text,text,text,timestamptz,boolean)', 'execute')
    and pg_catalog.has_function_privilege('authenticated', 'public.reassign_work_task(uuid,uuid)', 'execute')
    and pg_catalog.has_function_privilege('authenticated', 'public.cancel_work_task(uuid)', 'execute')
    and pg_catalog.has_function_privilege('authenticated', 'public.get_work_tasks(text,text,integer)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.create_work_task(text,text,timestamptz,text,uuid,text,timestamptz,uuid,uuid,uuid)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.get_work_tasks(text,text,integer)', 'execute'),
    'funções de tarefa: authenticated sim, anon nunca'
);

-- ─── Criar tarefa (ATTENDANT A, responsável B, ligada a contato e oportunidade) ──────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000002';

select set_config('tk.t1', public.create_work_task(
    'Ligar para o cliente', 'follow_up', now() + interval '2 days', 'high',
    'b5400003-0000-4000-8000-000000000003', 'Combinar visita', now() + interval '1 day',
    (select id from tk_ids where k = 'contact'), (select id from tk_ids where k = 'opp'), null
)->>'task_id', true);

select ok(current_setting('tk.t1')::uuid is not null, 'ATTENDANT cria tarefa com responsável, prazo, prioridade e lembrete');

reset role;
select results_eq(
    $$select task_type, title, status, priority, responsible_member_id::text, created_by_member_id::text, description, (reminder_at is not null)
      from public.work_tasks where id = current_setting('tk.t1')::uuid$$,
    $$values ('follow_up'::text, 'Ligar para o cliente'::text, 'pending'::text, 'high'::text,
              'b5400003-0000-4000-8000-000000000003'::text, 'b5400003-0000-4000-8000-000000000002'::text, 'Combinar visita'::text, true)$$,
    'a tarefa guarda tipo, título, prioridade, responsável, autor e lembrete'
);
select results_eq(
    $$select (contact_id is not null), (opportunity_id is not null), (conversation_id is null) from public.work_tasks where id = current_setting('tk.t1')::uuid$$,
    $$values (true, true, true)$$,
    'a tarefa fica ligada ao contato e à oportunidade'
);
select is(
    (select count(*) from public.audit_events where action = 'task.created' and target_id = current_setting('tk.t1')::uuid and actor_member_id = 'b5400003-0000-4000-8000-000000000002'),
    1::bigint,
    'criar tarefa é auditado (autor A)'
);
select ok(
    not exists (select 1 from public.audit_events where action = 'task.created' and (metadata::text ilike '%Combinar visita%' or metadata::text ilike '%Ligar para o cliente%')),
    'a auditoria não copia título nem descrição'
);

-- ─── Validações ──────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000002';
select throws_ok($$select public.create_work_task('x', 'task', null, 'normal', null, null, null, null, null, null)$$, '42501', 'resource_not_available', 'tarefa precisa de contato, oportunidade ou conversa');
select throws_ok($$select public.create_work_task('   ', 'task', null, 'normal', null, null, null, (select id from tk_ids where k = 'contact'), null, null)$$, '22023', 'invalid_task', 'título vazio é recusado');
select throws_ok($$select public.create_work_task('t', 'task', null, 'urgentissima', null, null, null, (select id from tk_ids where k = 'contact'), null, null)$$, '22023', 'invalid_task', 'prioridade inválida é recusada');
select throws_ok($$select public.create_work_task('t', 'lembrete', null, 'normal', null, null, null, (select id from tk_ids where k = 'contact'), null, null)$$, '22023', 'invalid_task', 'tipo inválido é recusado');
select throws_ok($$select public.create_work_task('t', 'task', now() + interval '1 day', 'normal', null, null, now() + interval '2 days', (select id from tk_ids where k = 'contact'), null, null)$$, '22023', 'invalid_task', 'lembrete depois do prazo é recusado');
select throws_ok($$select public.create_work_task('t', 'task', null, 'normal', 'b5400003-0000-4000-8000-000000000004', null, null, (select id from tk_ids where k = 'contact'), null, null)$$, '22023', 'assignee_not_active', 'não atribui a membro suspenso');
select throws_ok($$select public.create_work_task('t', 'task', null, 'normal', 'b5400003-0000-4000-8000-000000000009', null, null, (select id from tk_ids where k = 'contact'), null, null)$$, '22023', 'assignee_not_active', 'nem a membro de outro workspace');
select throws_ok($$select public.create_work_task('t', 'task', null, 'normal', null, null, null, (select id from tk_ids where k = 'prot'), null, null)$$, '42501', 'resource_not_available', 'ATTENDANT não cria tarefa para contato protegido');

-- OWNER: contexto privado só aceita responsável OWNER
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000001';
select throws_ok($$select public.create_work_task('Privada', 'task', null, 'normal', 'b5400003-0000-4000-8000-000000000002', null, null, (select id from tk_ids where k = 'prot'), null, null)$$, '22023', 'assignee_cannot_access_task', 'tarefa de contato protegido não pode ir para ATTENDANT');
select set_config('tk.priv', public.create_work_task('Privada do dono', 'task', null, 'normal', 'b5400003-0000-4000-8000-000000000001', null, null, (select id from tk_ids where k = 'prot'), null, null)->>'task_id', true);
select ok(current_setting('tk.priv')::uuid is not null, 'OWNER cria tarefa privada para si mesmo');

-- ─── Visibilidade herdada do contexto (RLS) ─────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000003';
select is((select count(*) from public.work_tasks where id = current_setting('tk.t1')::uuid), 1::bigint, 'o responsável (B) vê a tarefa');
select is((select count(*) from public.work_tasks where id = current_setting('tk.priv')::uuid), 0::bigint, 'ATTENDANT não vê tarefa de contato protegido');
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000009';
select is((select count(*) from public.work_tasks), 0::bigint, 'outro workspace não vê nenhuma tarefa');

-- ─── Editar, reatribuir ────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000003';
select is(
    (select public.update_work_task(current_setting('tk.t1')::uuid, p_title => 'Ligar e confirmar visita', p_priority => 'urgent')->>'success'),
    'true',
    'quem tem acesso edita a tarefa pendente'
);
select throws_ok(
    $$select public.update_work_task(current_setting('tk.t1')::uuid, p_due_at => now() + interval '1 hour')$$,
    '22023', 'invalid_task',
    'editar o prazo para antes do lembrete é recusado'
);
select is(
    (select public.update_work_task(current_setting('tk.t1')::uuid, p_clear_reminder => true, p_due_at => now() + interval '1 hour')->>'success'),
    'true',
    'remover o lembrete permite antecipar o prazo'
);
select is(
    (select public.reassign_work_task(current_setting('tk.t1')::uuid, 'b5400003-0000-4000-8000-000000000002')->>'status'),
    'reassigned',
    'troca de responsável'
);
select is(
    (select public.reassign_work_task(current_setting('tk.t1')::uuid, null)->>'status'),
    'unassigned',
    'tarefa pode ficar sem responsável'
);
select throws_ok(
    $$select public.reassign_work_task(current_setting('tk.t1')::uuid, 'b5400003-0000-4000-8000-000000000004')$$,
    '22023', 'assignee_not_active',
    'não reatribui a membro suspenso'
);

reset role;
select results_eq(
    $$select title, priority, responsible_member_id::text, created_by_member_id::text from public.work_tasks where id = current_setting('tk.t1')::uuid$$,
    $$values ('Ligar e confirmar visita'::text, 'urgent'::text, null::text, 'b5400003-0000-4000-8000-000000000002'::text)$$,
    'edições aplicadas; o autor original não muda'
);
select is(
    (select count(*) from public.audit_events where action in ('task.updated', 'task.reassigned') and target_id = current_setting('tk.t1')::uuid),
    4::bigint,
    'cada edição e troca de responsável é auditada'
);

-- ─── Listagem ─────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000002';
select set_config('tk.t2', public.create_work_task('Atrasada', 'task', now() - interval '3 days', 'normal', 'b5400003-0000-4000-8000-000000000002', null, null, (select id from tk_ids where k = 'contact'), null, null)->>'task_id', true);
select is((select jsonb_array_length(public.get_work_tasks('pending')->'tasks')), 2, 'lista as pendentes visíveis (sem a privada)');
select is((public.get_work_tasks('pending')->'tasks'->0->>'title'), 'Atrasada', 'ordena por prazo (a mais urgente primeiro)');
select is((public.get_work_tasks('pending')->'tasks'->0->>'is_overdue')::boolean, true, 'marca a tarefa atrasada');
select is((select jsonb_array_length(public.get_work_tasks('pending', 'mine')->'tasks')), 1, 'escopo "minhas" traz só as minhas');
select is((select jsonb_array_length(public.get_work_tasks('pending', 'unassigned')->'tasks')), 1, 'escopo "sem responsável" traz só as sem dono');
select is(
    (select (public.get_work_tasks()->'counts'->>'overdue')::int || '/' || (public.get_work_tasks()->'counts'->>'pending') || '/' || (public.get_work_tasks()->'counts'->>'mine')),
    '1/2/1',
    'contadores: atrasadas / pendentes / minhas'
);
select is(public.get_work_tasks('pending')->'tasks'->1->>'contact_name', 'Cliente TK', 'a lista traz o nome do contato');
select throws_ok($$select public.get_work_tasks('qualquer')$$, '22023', 'invalid_task_filter', 'filtro inválido é recusado');

-- ─── Concluir e cancelar ────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5400000-0000-4000-8000-000000000003';
select is((select public.complete_work_task(current_setting('tk.t2')::uuid)->>'success'), 'true', 'quem tem acesso conclui a tarefa');
select throws_ok($$select public.complete_work_task(current_setting('tk.t2')::uuid)$$, '55000', 'task_not_pending', 'concluir de novo é recusado');
select is((select public.cancel_work_task(current_setting('tk.t1')::uuid)->>'success'), 'true', 'tarefa pendente pode ser cancelada');
select throws_ok($$select public.cancel_work_task(current_setting('tk.t2')::uuid)$$, '55000', 'task_not_pending', 'não cancela tarefa já concluída');
select throws_ok($$select public.update_work_task(current_setting('tk.t1')::uuid, p_title => 'x')$$, '55000', 'task_not_pending', 'tarefa cancelada não é editável');

reset role;
select results_eq(
    $$select status, completed_by_member_id::text, (completed_at is not null) from public.work_tasks where id = current_setting('tk.t2')::uuid$$,
    $$values ('completed'::text, 'b5400003-0000-4000-8000-000000000003'::text, true)$$,
    'conclusão registra ator e momento; o autor original fica'
);
select is(
    (select current_stage_id::text from public.opportunities where id = 'b5400007-0000-4000-8000-000000000001'),
    'b5400005-0000-4000-8000-000000000001',
    'concluir/cancelar tarefa não move a oportunidade de etapa'
);
select is(
    (select count(*) from public.audit_events where action in ('task.completed', 'task.cancelled')),
    2::bigint,
    'conclusão e cancelamento são auditados'
);

select * from finish();
rollback;
