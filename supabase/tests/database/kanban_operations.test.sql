begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(18);

-- ─── 1. Setup de Fixtures de Teste ───────────────────────────────────────────

insert into auth.users (id, email)
values
    ('10000000-0000-4000-8000-000000000001', 'kanban_owner1@example.test'),
    ('10000000-0000-4000-8000-000000000002', 'kanban_owner2@example.test')
on conflict (id) do nothing;

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Corretor Kanban 1', 'active'),
    ('11000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Corretor Kanban 2', 'active')
on conflict (id) do nothing;

insert into public.workspaces (id, name, status, timezone)
values
    ('21000000-0000-4000-8000-000000000001', 'Imobiliária KB 1', 'active', 'America/Maceio'),
    ('21000000-0000-4000-8000-000000000002', 'Imobiliária KB 2', 'active', 'America/Maceio')
on conflict (id) do nothing;

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at)
values
    ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
    ('31000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000002', 'owner', 'active', now())
on conflict (id) do nothing;

insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values
    ('41000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Prospecção KB', 1, true, 'prospecting'),
    ('41000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', 'Visita Agendada KB', 2, true, 'qualification'),
    ('41000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000001', 'Proposta KB', 3, true, 'proposal')
on conflict (id) do nothing;

insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected)
values
    ('51000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Cliente Kanban 1', 'client', 'active', false),
    ('51000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 'Cliente Kanban 2', 'client', 'active', false)
on conflict (id) do nothing;

-- Autentica como Usuário 1 do Workspace 1
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000001"}';

-- ----------------------------------------------------------------------------
-- Teste 1: get_kanban_board retorna etapas ordenadas por posição
-- ----------------------------------------------------------------------------
select is(
    (select jsonb_array_length(public.get_kanban_board(50))),
    3,
    'get_kanban_board deve retornar 3 etapas ativas'
);

-- ----------------------------------------------------------------------------
-- Teste 2: Criar Oportunidade Válida
-- ----------------------------------------------------------------------------
select set_config('test.opp1_id',
    public.create_opportunity(
        '51000000-0000-4000-8000-000000000001'::uuid,
        '41000000-0000-4000-8000-000000000001'::uuid,
        'Apartamento Jatiúca 3 Quatros',
        'Cliente interessado na vista pro mar',
        '31000000-0000-4000-8000-000000000001'::uuid
    )::text,
    true
);

select ok(
    current_setting('test.opp1_id')::uuid is not null,
    'Oportunidade criada com sucesso e retornou UUID'
);

-- Verificar se a oportunidade foi salva em opportunities
select results_eq(
    format('select title, status, current_stage_id from public.opportunities where id = %L', current_setting('test.opp1_id')),
    format('values (%L::text, %L::text, %L::uuid)', 'Apartamento Jatiúca 3 Quatros', 'open', '41000000-0000-4000-8000-000000000001'),
    'Oportunidade salva em status open no estágio Prospecção KB'
);

-- Verificar registro em pipeline_history
select results_eq(
    format('select previous_stage_id, new_stage_id, changed_by_member_id from public.pipeline_history where opportunity_id = %L', current_setting('test.opp1_id')),
    format('values (null::uuid, %L::uuid, %L::uuid)', '41000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001'),
    'pipeline_history deve conter entrada inicial com previous_stage_id nulo'
);

-- Verificar registro em audit_events
select results_eq(
    format('select action, target_type, target_id from public.audit_events where target_id = %L', current_setting('test.opp1_id')),
    format('values (%L::text, %L::text, %L::uuid)', 'opportunity.created', 'opportunity', current_setting('test.opp1_id')),
    'audit_events deve registrar o evento opportunity.created'
);

-- ----------------------------------------------------------------------------
-- Teste 3: Rejeitar criação com Contato Falso / Inválido
-- ----------------------------------------------------------------------------
select throws_ok(
    format(
        'select public.create_opportunity(%L::uuid, %L::uuid, %L::text)',
        '00000000-0000-4000-a000-999999999999',
        '41000000-0000-4000-8000-000000000001',
        'Opp Invalida'
    ),
    '22023',
    'contact_not_found_or_inactive',
    'Deve lançar exceção contact_invalid ao usar contato inexistente'
);

-- ----------------------------------------------------------------------------
-- Teste 4: Rejeitar criação com Etapa Inexistente
-- ----------------------------------------------------------------------------
select throws_ok(
    format(
        'select public.create_opportunity(%L::uuid, %L::uuid, %L::text)',
        '51000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-a000-999999999999',
        'Opp Invalida'
    ),
    '22023',
    'stage_not_found_or_inactive',
    'Deve lançar exceção stage_invalid ao usar etapa inexistente'
);

-- ----------------------------------------------------------------------------
-- Teste 5: Rejeitar criação com Responsável de Outro Workspace
-- ----------------------------------------------------------------------------
select throws_ok(
    format(
        'select public.create_opportunity(%L::uuid, %L::uuid, %L::text, null, %L::uuid)',
        '51000000-0000-4000-8000-000000000001',
        '41000000-0000-4000-8000-000000000001',
        'Opp Invalida',
        '31000000-0000-4000-8000-000000000002' -- Membro do Workspace 2
    ),
    '22023',
    'responsible_member_invalid',
    'Deve lançar exceção responsible_member_invalid ao usar membro de outro workspace'
);

-- ----------------------------------------------------------------------------
-- Teste 6: Movimentação Válida de Etapa
-- ----------------------------------------------------------------------------
select is(
    (
        select public.move_opportunity_stage(
            current_setting('test.opp1_id')::uuid,
            '41000000-0000-4000-8000-000000000001'::uuid,
            '41000000-0000-4000-8000-000000000002'::uuid,
            'Cliente confirmou horário da visita'
        )->>'status'
    ),
    'success',
    'move_opportunity_stage deve retornar status success para movimentação válida'
);

-- Verificar se o estágio foi atualizado em opportunities
select results_eq(
    format('select current_stage_id from public.opportunities where id = %L', current_setting('test.opp1_id')),
    format('values (%L::uuid)', '41000000-0000-4000-8000-000000000002'),
    'Estágio da oportunidade deve ter sido atualizado para Visita Agendada KB'
);

-- Verificar se um novo registro de histórico foi adicionado em pipeline_history
select is(
    (select count(*)::integer from public.pipeline_history where opportunity_id = current_setting('test.opp1_id')::uuid),
    2,
    'pipeline_history deve conter exatamente 2 registros (criação + movimentação)'
);

-- ----------------------------------------------------------------------------
-- Teste 7: Movimentação para a Mesma Etapa (no_change)
-- ----------------------------------------------------------------------------
select is(
    (
        select public.move_opportunity_stage(
            current_setting('test.opp1_id')::uuid,
            '41000000-0000-4000-8000-000000000002'::uuid,
            '41000000-0000-4000-8000-000000000002'::uuid,
            'Tentativa redundante'
        )->>'status'
    ),
    'no_change',
    'move_opportunity_stage deve retornar no_change quando etapa de destino for a mesma'
);

-- Garantir que no_change NAO insere novo histórico
select is(
    (select count(*)::integer from public.pipeline_history where opportunity_id = current_setting('test.opp1_id')::uuid),
    2,
    'pipeline_history NAO deve ter nova linha em caso de no_change'
);

-- ----------------------------------------------------------------------------
-- Teste 8: Detecção de Concorrência / Conflito (expected_current_stage_id incorreto)
-- ----------------------------------------------------------------------------
select is(
    (
        select public.move_opportunity_stage(
            current_setting('test.opp1_id')::uuid,
            '41000000-0000-4000-8000-000000000001'::uuid, -- Passa a etapa antiga como observada
            '41000000-0000-4000-8000-000000000003'::uuid,
            'Movimentação baseada em estado desatualizado'
        )->>'status'
    ),
    'conflict',
    'move_opportunity_stage deve retornar status conflict quando p_expected_current_stage_id for desatualizado'
);

-- Garantir que conflito NAO insere novo histórico nem altera estágio
select is(
    (select count(*)::integer from public.pipeline_history where opportunity_id = current_setting('test.opp1_id')::uuid),
    2,
    'pipeline_history NAO deve ter nova linha em caso de conflito de concorrência'
);

-- ----------------------------------------------------------------------------
-- Teste 9: get_kanban_board agora contem a oportunidade na coluna Visita KB
-- ----------------------------------------------------------------------------
select is(
    (
        select jsonb_array_length(cards)
        from jsonb_to_recordset(public.get_kanban_board(50)) as x(id uuid, name text, cards jsonb)
        where name = 'Visita Agendada KB'
    ),
    1,
    'Coluna Visita Agendada KB no get_kanban_board deve conter exatamente 1 card'
);

-- ----------------------------------------------------------------------------
-- Teste 10: Tentar atualizar opportunities diretamente via SQL (Bloqueado)
-- ----------------------------------------------------------------------------
select throws_ok(
    format(
        'update public.opportunities set current_stage_id = %L where id = %L',
        '41000000-0000-4000-8000-000000000001',
        current_setting('test.opp1_id')
    ),
    '42501',
    null,
    'Atualização direta na tabela opportunities pelo cliente deve ser negada por RLS/Privilégios'
);

-- Reset de papel para verificação de isolamento RLS entre workspaces
set local role postgres;

-- ----------------------------------------------------------------------------
-- Teste 11: Isolamento entre Workspaces diferentes
-- ----------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000002"}';

-- Usuário do Workspace 2 tenta mover oportunidade do Workspace 1
select throws_ok(
    format(
        'select public.move_opportunity_stage(%L::uuid, %L::uuid, %L::uuid)',
        current_setting('test.opp1_id'),
        '41000000-0000-4000-8000-000000000002',
        '41000000-0000-4000-8000-000000000001'
    ),
    '22023',
    'opportunity_not_found',
    'Usuário de outro workspace deve ter acesso negado ao tentar mover oportunidade do Workspace 1'
);

select * from finish();

rollback;
