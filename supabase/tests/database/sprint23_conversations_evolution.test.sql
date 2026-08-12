begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;
select plan(29);

-- 1. Criar Auth Users de teste
insert into auth.users (id, email)
values
    ('a2300000-0000-4000-8000-000000000001', 'owner_sprint23@example.test'),
    ('a2300000-0000-4000-8000-000000000002', 'attendant_sprint23@example.test'),
    ('a2300000-0000-4000-8000-000000000003', 'other_owner_sprint23@example.test')
on conflict (id) do nothing;

-- 2. Criar Workspaces de teste (Workspace 1 e Workspace 2 para isolamento)
insert into public.workspaces (id, name, status, timezone)
values
    ('92300000-0000-4000-8000-000000000001', 'Workspace Sprint 23 A', 'active', 'America/Maceio'),
    ('92300000-0000-4000-8000-000000000002', 'Workspace Sprint 23 B', 'active', 'America/Maceio')
on conflict (id) do nothing;

-- 3. Criar App Users (Owner, Attendant e Owner B)
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('92300000-0000-4000-8000-000000000011', 'a2300000-0000-4000-8000-000000000001', 'Owner Sprint 23', 'active'),
    ('92300000-0000-4000-8000-000000000012', 'a2300000-0000-4000-8000-000000000002', 'Attendant Sprint 23', 'active'),
    ('92300000-0000-4000-8000-000000000013', 'a2300000-0000-4000-8000-000000000003', 'Other Owner Sprint 23', 'active')
on conflict (id) do nothing;

-- 4. Criar Memberships
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('92300000-0000-4000-8000-000000000021', '92300000-0000-4000-8000-000000000001', '92300000-0000-4000-8000-000000000011', 'owner', 'active', now(), null),
    ('92300000-0000-4000-8000-000000000022', '92300000-0000-4000-8000-000000000001', '92300000-0000-4000-8000-000000000012', 'attendant', 'active', now(), '92300000-0000-4000-8000-000000000021'),
    ('92300000-0000-4000-8000-000000000023', '92300000-0000-4000-8000-000000000002', '92300000-0000-4000-8000-000000000013', 'owner', 'active', now(), null)
on conflict (id) do nothing;

-- 5. Provisionar Etapas dos Workspaces
select provision_default_pipeline_stages('92300000-0000-4000-8000-000000000001');
select provision_default_pipeline_stages('92300000-0000-4000-8000-000000000002');

-- ─── 1. VERIFICAÇÃO DE ESTRUTURA DA TABELA conversation_read_states ──────────

select has_table('public', 'conversation_read_states', 'Tabela conversation_read_states deve existir');
select has_column('public', 'conversation_read_states', 'workspace_id', 'Coluna workspace_id deve existir');
select has_column('public', 'conversation_read_states', 'conversation_id', 'Coluna conversation_id deve existir');
select has_column('public', 'conversation_read_states', 'member_id', 'Coluna member_id deve existir');
select has_column('public', 'conversation_read_states', 'is_unread', 'Coluna is_unread deve existir');

-- Verificar que RLS está habilitado
select ok(
    exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'conversation_read_states' and rowsecurity = true
    ),
    'RLS deve estar habilitado em conversation_read_states'
);

-- Verificar que FKs usam RESTRICT (não CASCADE)
select ok(
    not exists (
        select 1
        from information_schema.referential_constraints rc
        join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
        where tc.table_name = 'conversation_read_states' and rc.delete_rule = 'CASCADE'
    ),
    'Nenhuma FK em conversation_read_states pode usar ON DELETE CASCADE'
);

-- ─── 2. SEED DE CONVERSAS E DADOS PARA OS TESTES FUNCIONAIS ───────────────────

set search_path = public, extensions, pg_catalog;

-- Criar Instância de Canal
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('82300000-0000-4000-8000-000000000002', '92300000-0000-4000-8000-000000000001', 'whatsapp', 'inst-23', '+5582999992323', 'active', now())
on conflict (id) do nothing;

-- Criar Contato 1 no Workspace A
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, commercial_visible_from)
values ('82300000-0000-4000-8000-000000000003', '92300000-0000-4000-8000-000000000001', 'Cliente Sp23 A', 'lead', 'active', now())
on conflict (id) do nothing;

-- Criar Oportunidade 1 no Workspace A
insert into public.opportunities (
    id, workspace_id, title, contact_id, current_stage_id, status, responsible_member_id,
    family_income, financial_analysis_status, approved_amount
)
values (
    '82300000-0000-4000-8000-000000000004', '92300000-0000-4000-8000-000000000001', 'Opp Sp23 A', '82300000-0000-4000-8000-000000000003',
    (select id from public.pipeline_stages where workspace_id = '92300000-0000-4000-8000-000000000001' and position = 1),
    'open', '92300000-0000-4000-8000-000000000021',
    15000.00, 'approved', 450000.00
)
on conflict (id) do nothing;

-- Criar Conversa 1 no Workspace A
insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, visibility, operational_status, started_at, commercial_visible_from, privacy_changed_at)
values ('82300000-0000-4000-8000-000000000005', '92300000-0000-4000-8000-000000000001', '82300000-0000-4000-8000-000000000002', '5582998880001@s.whatsapp.net', 'individual', 'commercial', 'active', now(), now(), now())
on conflict (id) do nothing;

-- Criar Contact Point para o Contato A
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status, commercial_visible_from)
values ('82300000-0000-4000-8000-000000000006', '92300000-0000-4000-8000-000000000001', '82300000-0000-4000-8000-000000000003', 'phone', '+5582998880001', '(82) 99888-0001', 'active', now())
on conflict (id) do nothing;

insert into public.conversation_participants (workspace_id, conversation_id, contact_point_id, first_seen_at)
values ('92300000-0000-4000-8000-000000000001', '82300000-0000-4000-8000-000000000005', '82300000-0000-4000-8000-000000000006', now())
on conflict (id) do nothing;

insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
values ('92300000-0000-4000-8000-000000000001', '82300000-0000-4000-8000-000000000004', '82300000-0000-4000-8000-000000000005', '92300000-0000-4000-8000-000000000021', now())
on conflict do nothing;

-- ─── 3. TESTES DE AUTORIZAÇÃO E SEGURANÇA (OWNER vs ATTENDANT vs ISOLAMENTO) ──

-- A. Contexto OWNER A
set local role authenticated;
set local search_path = public, extensions, pg_catalog;
set local "request.jwt.claim.sub" = 'a2300000-0000-4000-8000-000000000001';

-- 1. OWNER pode marcar conversa como não lida
select is(
    (public.mark_conversation_unread('82300000-0000-4000-8000-000000000005', true)->>'is_unread')::boolean,
    true,
    'mark_conversation_unread deve alterar is_unread para true'
);

select results_eq(
    'select is_unread from public.conversation_read_states where conversation_id = ''82300000-0000-4000-8000-000000000005''',
    array[true],
    'Tabela conversation_read_states deve registrar is_unread = true para a conversa'
);

-- 2. get_conversations_list deve indicar is_unread = true
select results_eq(
    'select is_unread from public.get_conversations_list() where conversation_id = ''82300000-0000-4000-8000-000000000005''',
    array[true],
    'get_conversations_list deve retornar o atributo is_unread = true'
);

-- 3. OWNER consulta get_conversation_context e RECEBE dados financeiros
select is(
    ((public.get_conversation_context('82300000-0000-4000-8000-000000000005')->'financial_info')->>'family_income')::numeric,
    15000.00,
    'OWNER deve conseguir acessar dados financeiros no get_conversation_context'
);

-- B. Contexto ATTENDANT A
set local role authenticated;
set local search_path = public, extensions, pg_catalog;
set local "request.jwt.claim.sub" = 'a2300000-0000-4000-8000-000000000002';

-- 4. ATTENDANT consulta get_conversation_context e NÃO RECEBE dados financeiros (PROTEÇÃO OWNER-ONLY / AUTORIZAÇÃO NEGATIVA)
select is(
    (public.get_conversation_context('82300000-0000-4000-8000-000000000005')->'financial_info'),
    'null'::jsonb,
    'ATTENDANT deve receber financial_info NULL no get_conversation_context (proteção financeira)'
);

-- 5. ATTENDANT pode marcar como lida a conversa no próprio workspace
select is(
    (public.mark_conversation_unread('82300000-0000-4000-8000-000000000005', false)->>'is_unread')::boolean,
    false,
    'ATTENDANT pode marcar conversa como lida'
);

-- C. Contexto OTHER OWNER B (ISOLAMENTO ENTRE WORKSPACES / AUTORIZAÇÃO NEGATIVA)
set local role authenticated;
set local search_path = public, extensions, pg_catalog;
set local "request.jwt.claim.sub" = 'a2300000-0000-4000-8000-000000000003';

-- 6. OWNER de outro workspace tentar marcar conversa do Workspace A lança exceção (Membro não encontrado no workspace)
prepare unread_cross_workspace as select public.mark_conversation_unread('82300000-0000-4000-8000-000000000005', true);
select throws_ok(
    'execute unread_cross_workspace',
    '42501',
    'conversation_not_available',
    'Isolamento RLS: Usuário do Workspace B não pode alterar leitura de conversa do Workspace A'
);

-- 7. OWNER de outro workspace não visualiza a conversa do Workspace A na listagem
select is(
    (select count(*)::integer from public.get_conversations_list() where conversation_id = '82300000-0000-4000-8000-000000000005'),
    0,
    'Isolamento RLS: get_conversations_list do Workspace B não vaza conversas do Workspace A'
);

-- ─── 4. TESTES DE WORK_TASKS (PRÓXIMA AÇÃO & FOLLOW-UP) ──────────────────────

-- Voltar ao contexto do OWNER A
set local role authenticated;
set local search_path = public, extensions, pg_catalog;
set local "request.jwt.claim.sub" = 'a2300000-0000-4000-8000-000000000001';

-- 1. Criar tarefa do tipo task (Próxima ação)
select set_config(
    'test.task_1_id',
    (public.upsert_work_task(
        'task', 'Ligar para cliente apresentar imóvel', now() + interval '2 hours',
        '82300000-0000-4000-8000-000000000003', '82300000-0000-4000-8000-000000000004', '82300000-0000-4000-8000-000000000005'
    )->>'task_id'),
    true
);

select ok(current_setting('test.task_1_id', true) is not null, 'upsert_work_task deve criar próxima ação com sucesso');

select results_eq(
    'select task_type from public.work_tasks where id = ''' || current_setting('test.task_1_id', true) || '''',
    array['task'],
    'Tarefa deve ter task_type = ''task'''
);

-- 2. Criar tarefa do tipo follow_up
select set_config(
    'test.followup_1_id',
    (public.upsert_work_task(
        'follow_up', 'Follow-up de proposta enviada', now() + interval '1 day',
        '82300000-0000-4000-8000-000000000003', '82300000-0000-4000-8000-000000000004', '82300000-0000-4000-8000-000000000005'
    )->>'task_id'),
    true
);

select results_eq(
    'select task_type from public.work_tasks where id = ''' || current_setting('test.followup_1_id', true) || '''',
    array['follow_up'],
    'Follow-up deve ter task_type = ''follow_up'''
);

-- 3. Concluir a tarefa via complete_work_task
select is(
    (public.complete_work_task(current_setting('test.task_1_id', true)::uuid)->>'success')::boolean,
    true,
    'complete_work_task deve retornar success = true'
);

select results_eq(
    'select status from public.work_tasks where id = ''' || current_setting('test.task_1_id', true) || '''',
    array['completed'],
    'complete_work_task deve alterar o status da tarefa para completed'
);

-- 4. Garantir que concluir a tarefa NÃO altera a etapa da oportunidade no Kanban
select is(
    (select current_stage_id::text from public.opportunities where id = '82300000-0000-4000-8000-000000000004'),
    (select id::text from public.pipeline_stages where workspace_id = '92300000-0000-4000-8000-000000000001' and position = 1),
    'Concluir uma tarefa/follow-up NÃO pode alterar a etapa da oportunidade no Kanban'
);

-- ─── 5. TESTES DE NOTAS INTERNAS E QUALIFICAÇÃO DA OPORTUNIDADE ─────────────

-- 1. Salvar nota interna via save_internal_note
select set_config(
    'test.note_1_id',
    (public.save_internal_note('82300000-0000-4000-8000-000000000005', 'Cliente prefere ligar no período da tarde')->>'note_id'),
    true
);

select ok(current_setting('test.note_1_id', true) is not null, 'save_internal_note deve salvar nota interna com sucesso');

select results_eq(
    'select content from public.internal_notes where id = ''' || current_setting('test.note_1_id', true) || '''',
    array['Cliente prefere ligar no período da tarde'],
    'Nota interna salva deve ter o conteúdo esperado'
);

-- 2. Atualizar qualificação da oportunidade via update_contact_opportunity_qualification
select is(
    (public.update_contact_opportunity_qualification(
        '82300000-0000-4000-8000-000000000003',
        '82300000-0000-4000-8000-000000000004',
        'buy', 'apartamento', 'Maceió/Ponta Verde', 800000.00, 200000.00, '3_months'
    )->>'success')::boolean,
    true,
    'update_contact_opportunity_qualification deve atualizar a oportunidade com sucesso'
);

select results_eq(
    'select operation_type from public.opportunities where id = ''82300000-0000-4000-8000-000000000004''',
    array['buy'],
    'Oportunidade atualizada deve registrar operation_type = buy'
);

select results_eq(
    'select property_type_preference from public.opportunities where id = ''82300000-0000-4000-8000-000000000004''',
    array['apartamento'],
    'Oportunidade atualizada deve registrar preferência por apartamento'
);

-- 3. Verificar que get_conversation_context retorna as tarefas, notas e a timeline atualizada
select is(
    (jsonb_array_length(public.get_conversation_context('82300000-0000-4000-8000-000000000005')->'notes') > 0),
    true,
    'get_conversation_context deve incluir as notas internas'
);

select is(
    (jsonb_array_length(public.get_conversation_context('82300000-0000-4000-8000-000000000005')->'tasks') > 0),
    true,
    'get_conversation_context deve incluir as tarefas'
);

select is(
    (jsonb_array_length(public.get_conversation_context('82300000-0000-4000-8000-000000000005')->'timeline') > 0),
    true,
    'get_conversation_context deve incluir a linha do tempo consolidada'
);

select finish();
rollback;
