-- ImobFlux Sprint 21 pgTAP Test Suite: Qualification, Rework, Closure & OWNER-only Financials RLS

begin;
set search_path = public, extensions, pg_catalog;
select plan(22);

-- ─── SETUP INICIAL ─────────────────────────────────────────────────────────────

create extension if not exists pgtap;

-- 1. Criar Auth Users de teste
insert into auth.users (id, email)
values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner_sprint21@example.test'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'attendant_sprint21@example.test')
on conflict (id) do nothing;

-- 2. Criar Workspace de teste
insert into public.workspaces (id, name, status, timezone)
values ('11111111-1111-1111-1111-111111111111', 'Test Workspace', 'active', 'America/Maceio')
on conflict (id) do nothing;

-- 3. Criar Usuários (Owner e Attendant)
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Owner', 'active'),
    ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test Attendant', 'active')
on conflict (id) do nothing;

-- 4. Criar Memberships
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'owner', 'active', now(), null),
    ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'attendant', 'active', now(), '44444444-4444-4444-4444-444444444444')
on conflict (id) do nothing;

-- 5. Provisionar as 6 etapas oficiais do Kanban
select provision_default_pipeline_stages('11111111-1111-1111-1111-111111111111');

-- ─── 1. VERIFICAÇÃO DE ESTRUTURA E TABELAS ──────────────────────────────────

select has_table('public', 'opportunity_financials', 'Tabela opportunity_financials deve existir');
select has_column('public', 'opportunities', 'operation_type', 'Coluna operation_type deve existir em opportunities');
select has_column('public', 'opportunities', 'rework_reason', 'Coluna rework_reason deve existir em opportunities');
select has_column('public', 'opportunities', 'loss_reason', 'Coluna loss_reason deve existir em opportunities');
select has_column('public', 'opportunities', 'family_income', 'Coluna family_income deve existir em opportunities');
select has_column('public', 'opportunities', 'documentation_status', 'Coluna documentation_status deve existir em opportunities');

-- ─── 2. VERIFICAÇÃO DE PROVISIONAMENTO DAS 6 ETAPAS ────────────────────────

select results_eq(
    'select count(*)::integer from public.pipeline_stages where workspace_id = ''11111111-1111-1111-1111-111111111111'' and is_active = true',
    array[6],
    'Devem ser provisionadas 6 etapas ativas no workspace'
);

select results_eq(
    'select name from public.pipeline_stages where workspace_id = ''11111111-1111-1111-1111-111111111111'' order by position asc',
    array['Em atendimento', 'Simulação / Análise', 'Documentação', 'Aprovado / Escolhendo imóvel', 'Negociação', 'Contrato'],
    'Nomes e posições das 6 etapas devem seguir a especificação aprovada'
);

-- ─── 3. TESTES FUNCIONAIS DAS RPCS COM CONTEXTO OWNER ─────────────────────────

-- Simular contexto autenticado do OWNER ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
set local role authenticated;
set local "request.jwt.claim.sub" = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- 1. Obter etapas
select set_config('test.stage_1_id', (select id::text from public.pipeline_stages where workspace_id = '11111111-1111-1111-1111-111111111111' and position = 1), true);
select set_config('test.stage_2_id', (select id::text from public.pipeline_stages where workspace_id = '11111111-1111-1111-1111-111111111111' and position = 2), true);

-- 2. Criar contato via RPC
select set_config('test.contact_id', public.create_contact('Cliente Teste Sprint 21', 'lead', '+5582999990021', '+55 82 99999-0021')::text, true);
select ok(current_setting('test.contact_id', true) is not null, 'Criar contato via RPC deve retornar contact_id válido');

-- 3. Criar oportunidade com campos de qualificação comercial
select set_config(
    'test.opp_1_id',
    public.create_opportunity(
        p_contact_id := current_setting('test.contact_id')::uuid,
        p_stage_id := current_setting('test.stage_1_id')::uuid,
        p_title := 'Compra Lote 2026',
        p_description := 'Descrição do lote',
        p_origin := 'WhatsApp Direct',
        p_property_summary := 'Loteamento Solar 250m2',
        p_operation_type := 'Compra',
        p_property_type_preference := 'Lote',
        p_city_region_preference := 'Maceió / Antares',
        p_value_range_preference := '150k - 200k',
        p_down_payment_available := 30000.00,
        p_timeframe_intent := 'Imediato'
    )::text,
    true
);
select ok(current_setting('test.opp_1_id', true) is not null, 'Criação de oportunidade com qualificação deve retornar UUID válido');

-- 4. Testar transição para RETRABALHO
select is(
    (public.set_opportunity_rework(
        p_opportunity_id := current_setting('test.opp_1_id')::uuid,
        p_rework_reason := 'Aguardando liberação de FGTS em 2027',
        p_rework_reevaluation_date := now() + interval '30 days'
    )->>'status'),
    'success',
    'Definir oportunidade como retrabalho deve ter sucesso'
);

select results_eq(
    format('select status, closed_at is null from public.opportunities where id = %L', current_setting('test.opp_1_id')),
    $$values ('rework'::text, true)$$,
    'Oportunidade em retrabalho deve ter status rework e closed_at NULL'
);

-- 5. Testar REATIVAÇÃO de Retrabalho
select is(
    (public.reactivate_opportunity(
        current_setting('test.opp_1_id')::uuid,
        current_setting('test.stage_2_id')::uuid
    )->>'status'),
    'success',
    'Reativar oportunidade deve ter sucesso'
);

select results_eq(
    format('select status, current_stage_id = %L, rework_reason is null from public.opportunities where id = %L', current_setting('test.stage_2_id'), current_setting('test.opp_1_id')),
    $$values ('open'::text, true, true)$$,
    'Oportunidade reativada deve voltar para status open e limpar motivo de retrabalho'
);

-- 6. Testar FECHAMENTO GANHO com valores financeiros (OWNER)
select is(
    (public.close_opportunity_won(
        p_opportunity_id := current_setting('test.opp_1_id')::uuid,
        p_business_value := 180000.00,
        p_commission_expected := 9000.00,
        p_commission_received := 4500.00
    )->>'status'),
    'success',
    'Fechar como Ganha com financeiros como OWNER deve ter sucesso'
);

select results_eq(
    format('select status, closed_at is not null from public.opportunities where id = %L', current_setting('test.opp_1_id')),
    $$values ('won'::text, true)$$,
    'Oportunidade ganha deve ter status won e closed_at preenchido'
);

select results_eq(
    format('select business_value, commission_expected, commission_received from public.opportunity_financials where opportunity_id = %L', current_setting('test.opp_1_id')),
    $$values (180000.00::numeric(14,2), 9000.00::numeric(14,2), 4500.00::numeric(14,2))$$,
    'Valores financeiros devem ser gravados em opportunity_financials'
);

-- 7. Testar FECHAMENTO PERDIDO (Exigindo motivo)
select set_config('test.opp_2_id', public.create_opportunity(current_setting('test.contact_id')::uuid, current_setting('test.stage_1_id')::uuid, 'Segunda Oportunidade')::text, true);

select is(
    (public.close_opportunity_lost(current_setting('test.opp_2_id')::uuid, 'Crédito reprovado no banco', 'Entrada insuficiente')->>'status'),
    'success',
    'Fechar como Perdida com motivo deve ter sucesso'
);

select results_eq(
    format('select status, loss_reason from public.opportunities where id = %L', current_setting('test.opp_2_id')),
    $$values ('lost'::text, 'Crédito reprovado no banco'::text)$$,
    'Oportunidade perdida deve registrar o motivo de perda'
);

-- 8. Testar CANCELADO
select set_config('test.opp_3_id', public.create_opportunity(current_setting('test.contact_id')::uuid, current_setting('test.stage_1_id')::uuid, 'Terceira Oportunidade')::text, true);

select is(
    (public.close_opportunity_cancelled(current_setting('test.opp_3_id')::uuid)->>'status'),
    'success',
    'Fechar como Cancelada deve ter sucesso'
);

-- ─── 4. TESTE DE SEGURANÇA E RLS EM OPPORTUNITY_FINANCIALS PARA ATTENDANT ───

-- Alternar contexto de execução para ATTENDANT ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- ATTENDANT tentando consultar opportunity_financials via RLS direta
select results_eq(
    'select count(*)::integer from public.opportunity_financials where workspace_id = ''11111111-1111-1111-1111-111111111111''',
    array[0],
    'ATTENDANT deve receber 0 linhas ao consultar public.opportunity_financials devido à política RLS estrita'
);

-- ATTENDANT tentando fechar como Ganha informando comissão deve ser BLOQUEADO com EXCEPTION
select throws_ok(
    $$ select close_opportunity_won('11111111-1111-1111-1111-111111111111', 100000.00, 5000.00, null) $$,
    '42501',
    'opportunity_operation_not_authorized',
    'ATTENDANT que tentar passar valores de comissão deve ser bloqueado no backend com EXCEPTION 42501'
);

select * from finish();
rollback;
