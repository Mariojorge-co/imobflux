-- ImobFlux Sprint 22: Carga do Demo Mode (20 Clientes Fictícios)
-- Execução Fail-Closed restrita ao PostgreSQL local do ImobFlux

set search_path to public, extensions, pg_catalog;

do $$
declare
  v_server_addr text := inet_server_addr()::text;
  v_database text := current_database();
  v_workspace_id uuid;
  v_owner_member_id uuid;
  v_count integer;
  
  v_stage1_id uuid;
  v_stage2_id uuid;
  v_stage3_id uuid;
  v_stage4_id uuid;
  v_stage5_id uuid;
  v_stage6_id uuid;
  
  v_channel_id uuid := 'd3300000-0000-4000-8000-000000000001';
begin
  set local search_path = public, pg_catalog;
  -- 1. Trava de Segurança Fail-Closed
  if v_database <> 'postgres' then
    raise exception 'SAFETY FAIL-CLOSED ABORT: Banco % não é a instância local padrão (postgres).', v_database;
  end if;

  if v_server_addr is null then
    raise exception 'SAFETY FAIL-CLOSED ABORT: inet_server_addr() é NULL. Conexão TCP local válida necessária.';
  end if;

  if v_server_addr !~ '^127\.0\.0\.1' 
     and v_server_addr !~ '^::1' 
     and v_server_addr !~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.' then
    raise exception 'SAFETY FAIL-CLOSED ABORT: IP do servidor % não é reconhecido como ambiente local.', v_server_addr;
  end if;

  -- 2. Resolução do Workspace Local e OWNER Ativo
  select count(*) into v_count
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id and wm.role = 'owner' and wm.status = 'active';

  if v_count <> 1 then
    raise exception 'SEGURANÇA FAIL-CLOSED: Esperado exatamente 1 workspace local com OWNER ativo, encontrado: %. Inicialize o ImobFlux localmente primeiro.', v_count;
  end if;

  select w.id, wm.id into v_workspace_id, v_owner_member_id
  from public.workspaces w
  join public.workspace_members wm on wm.workspace_id = w.id and wm.role = 'owner' and wm.status = 'active'
  limit 1;

  -- 3. Resolução das 6 Etapas Oficiais do Pipeline
  select id into v_stage1_id from public.pipeline_stages where workspace_id = v_workspace_id and position = 1;
  select id into v_stage2_id from public.pipeline_stages where workspace_id = v_workspace_id and position = 2;
  select id into v_stage3_id from public.pipeline_stages where workspace_id = v_workspace_id and position = 3;
  select id into v_stage4_id from public.pipeline_stages where workspace_id = v_workspace_id and position = 4;
  select id into v_stage5_id from public.pipeline_stages where workspace_id = v_workspace_id and position = 5;
  select id into v_stage6_id from public.pipeline_stages where workspace_id = v_workspace_id and position = 6;

  -- Limpar previamente qualquer carga demo anterior para garantir idempotência
  if to_regclass('public.opportunity_financials') is not null then
    delete from public.opportunity_financials where opportunity_id in (select id from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020');
  end if;
  if to_regclass('public.pipeline_history') is not null then
    execute 'alter table public.pipeline_history disable trigger trg_pipeline_history_prevent_mutation';
    delete from public.pipeline_history where opportunity_id in (select id from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020');
    execute 'alter table public.pipeline_history enable trigger trg_pipeline_history_prevent_mutation';
  end if;
  if to_regclass('public.opportunity_conversations') is not null then
    delete from public.opportunity_conversations where opportunity_id in (select id from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020');
  end if;
  if to_regclass('public.opportunities') is not null then
    delete from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020';
  end if;
  if to_regclass('public.messages') is not null then
    delete from public.messages where conversation_id in (select id from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000020');
  end if;
  if to_regclass('public.conversation_participants') is not null then
    delete from public.conversation_participants where conversation_id in (select id from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000020');
  end if;
  if to_regclass('public.conversation_assignments') is not null then
    delete from public.conversation_assignments where conversation_id in (select id from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000020');
  end if;
  if to_regclass('public.conversations') is not null then
    delete from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000020';
  end if;
  if to_regclass('public.contact_points') is not null then
    delete from public.contact_points where contact_id in (select id from public.contacts where id between 'd3300001-0000-4000-8000-000000000001' and 'd3300001-0000-4000-8000-000000000020');
  end if;
  if to_regclass('public.contacts') is not null then
    delete from public.contacts where id between 'd3300001-0000-4000-8000-000000000001' and 'd3300001-0000-4000-8000-000000000020';
  end if;
  delete from public.channel_connections where external_account_id = 'imobflux_demo_instance';

  -- 4. Inserir Canal Simulado de WhatsApp Demo
  insert into public.channel_connections (
    id, workspace_id, provider, external_account_id, external_phone_normalized, display_name, status, activated_at, created_at, updated_at
  ) values (
    v_channel_id, v_workspace_id, 'whatsapp', 'imobflux_demo_instance', '+5582999990000', 'WhatsApp Comercial (Demo)', 'active', now() - interval '30 days', now() - interval '30 days', now() - interval '30 days'
  );

  -- 5. Inserir os 20 Contatos Fictícios e Pontos de Contato
  -- Cliente 01
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000001', v_workspace_id, 'lead', 'Lucas Gabriel Silveira', 'active', now() - interval '2 days', now() - interval '5 minutes');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000001', v_workspace_id, 'd3300001-0000-4000-8000-000000000001', 'phone', '+5582999990001', '(82) 99999-0001', 'active');

  -- Cliente 02
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000002', v_workspace_id, 'lead', 'Amanda Maria Vasconcelos', 'active', now() - interval '1 day', now() - interval '12 minutes');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000002', v_workspace_id, 'd3300001-0000-4000-8000-000000000002', 'phone', '+5582999990002', '(82) 99999-0002', 'active');

  -- Cliente 03
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000003', v_workspace_id, 'lead', 'Bruno Henrique Martins', 'active', now() - interval '3 days', now() - interval '26 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000003', v_workspace_id, 'd3300001-0000-4000-8000-000000000003', 'phone', '+5582999990003', '(82) 99999-0003', 'active');

  -- Cliente 04
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000004', v_workspace_id, 'person', 'Camila Rocha Lima', 'active', now() - interval '5 days', now() - interval '3 days');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000004', v_workspace_id, 'd3300001-0000-4000-8000-000000000004', 'phone', '+5582999990004', '(82) 99999-0004', 'active');

  -- Cliente 05
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000005', v_workspace_id, 'lead', 'Diego Ramos Ferreira', 'active', now() - interval '4 days', now() - interval '3 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000005', v_workspace_id, 'd3300001-0000-4000-8000-000000000005', 'phone', '+5582999990005', '(82) 99999-0005', 'active');

  -- Cliente 06
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000006', v_workspace_id, 'lead', 'Elena Castro Mello', 'active', now() - interval '2 days', now() - interval '20 minutes');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000006', v_workspace_id, 'd3300001-0000-4000-8000-000000000006', 'phone', '+5582999990006', '(82) 99999-0006', 'active');

  -- Cliente 07
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000007', v_workspace_id, 'lead', 'Fernando Augusto Souza', 'active', now() - interval '6 days', now() - interval '36 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000007', v_workspace_id, 'd3300001-0000-4000-8000-000000000007', 'phone', '+5582999990007', '(82) 99999-0007', 'active');

  -- Cliente 08
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000008', v_workspace_id, 'client', 'Gabriela Nogueira Paes', 'active', now() - interval '8 days', now() - interval '45 minutes');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000008', v_workspace_id, 'd3300001-0000-4000-8000-000000000008', 'phone', '+5582999990008', '(82) 99999-0008', 'active');

  -- Cliente 09
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000009', v_workspace_id, 'lead', 'Heitor Alencar Mendes', 'active', now() - interval '10 days', now() - interval '5 days');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000009', v_workspace_id, 'd3300001-0000-4000-8000-000000000009', 'phone', '+5582999990009', '(82) 99999-0009', 'active');

  -- Cliente 10
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000010', v_workspace_id, 'client', 'Isabela Maria Freitas', 'active', now() - interval '7 days', now() - interval '24 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000010', v_workspace_id, 'd3300001-0000-4000-8000-000000000010', 'phone', '+5582999990010', '(82) 99999-0010', 'active');

  -- Cliente 11
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000011', v_workspace_id, 'client', 'João Pedro Guimarães', 'active', now() - interval '12 days', now() - interval '3 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000011', v_workspace_id, 'd3300001-0000-4000-8000-000000000011', 'phone', '+5582999990011', '(82) 99999-0011', 'active');

  -- Cliente 12
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000012', v_workspace_id, 'client', 'Larissa Beatriz Siqueira', 'active', now() - interval '14 days', now() - interval '48 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000012', v_workspace_id, 'd3300001-0000-4000-8000-000000000012', 'phone', '+5582999990012', '(82) 99999-0012', 'active');

  -- Cliente 13
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000013', v_workspace_id, 'lead', 'Marcelo Tavira Santos', 'active', now() - interval '9 days', now() - interval '4 days');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000013', v_workspace_id, 'd3300001-0000-4000-8000-000000000013', 'phone', '+5582999990013', '(82) 99999-0013', 'active');

  -- Cliente 14
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000014', v_workspace_id, 'client', 'Natalia Farias Duarte', 'active', now() - interval '15 days', now() - interval '6 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000014', v_workspace_id, 'd3300001-0000-4000-8000-000000000014', 'phone', '+5582999990014', '(82) 99999-0014', 'active');

  -- Cliente 15
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000015', v_workspace_id, 'client', 'Otavio Augusto Rezende', 'active', now() - interval '16 days', now() - interval '24 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000015', v_workspace_id, 'd3300001-0000-4000-8000-000000000015', 'phone', '+5582999990015', '(82) 99999-0015', 'active');

  -- Cliente 16
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000016', v_workspace_id, 'client', 'Patricia Carneiro Leão', 'active', now() - interval '20 days', now() - interval '2 hours');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000016', v_workspace_id, 'd3300001-0000-4000-8000-000000000016', 'phone', '+5582999990016', '(82) 99999-0016', 'active');

  -- Cliente 17
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000017', v_workspace_id, 'client', 'Rafael Medeiros Silveira', 'active', now() - interval '30 days', now() - interval '5 days');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000017', v_workspace_id, 'd3300001-0000-4000-8000-000000000017', 'phone', '+5582999990017', '(82) 99999-0017', 'active');

  -- Cliente 18 (Retrabalho)
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000018', v_workspace_id, 'lead', 'Sofia Helena Barreto', 'active', now() - interval '25 days', now() - interval '12 days');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000018', v_workspace_id, 'd3300001-0000-4000-8000-000000000018', 'phone', '+5582999990018', '(82) 99999-0018', 'active');

  -- Cliente 19 (Perdido)
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000019', v_workspace_id, 'lead', 'Thiago Vinicius Correia', 'active', now() - interval '22 days', now() - interval '15 days');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000019', v_workspace_id, 'd3300001-0000-4000-8000-000000000019', 'phone', '+5582999990019', '(82) 99999-0019', 'active');

  -- Cliente 20 (Cancelado)
  insert into public.contacts (id, workspace_id, classification, display_name, operational_status, created_at, updated_at)
  values ('d3300001-0000-4000-8000-000000000020', v_workspace_id, 'person', 'Vanessa Cristina Andrade', 'active', now() - interval '28 days', now() - interval '20 days');
  insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
  values ('d3300004-0000-4000-8000-000000000020', v_workspace_id, 'd3300001-0000-4000-8000-000000000020', 'phone', '+5582999990020', '(82) 99999-0020', 'active');


  -- 6. Inserir as 20 Oportunidades com Qualificações Comerciais Completa
  -- Opp 01 (Em atendimento)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000001', v_workspace_id, 'd3300001-0000-4000-8000-000000000001', v_stage1_id, 'Apê 2/4 no Farol', 'open', null, 'Instagram Ads', 'Apartamento 2/4 no Farol com varanda',
    'Compra', 'Apartamento', 'Maceió / Farol', '250k - 350k', 40000.00, 'Curto prazo (90 dias)', 'Prefere andar alto', null, 'not_analyzed', null, null, 'not_sent', now() - interval '2 days', now() - interval '5 minutes'
  );

  -- Opp 02 (Em atendimento)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000002', v_workspace_id, 'd3300001-0000-4000-8000-000000000002', v_stage1_id, 'Casa Condomínio Marechal', 'open', null, 'WhatsApp Direct', 'Casa 3 suítes em condomínio fechado',
    'Compra', 'Casa em Condomínio', 'Marechal Deodoro', '700k - 900k', 150000.00, 'Imediato (30 dias)', 'Precisa de área de lazer privativa', 18000.00, 'not_analyzed', null, null, 'not_sent', now() - interval '1 day', now() - interval '12 minutes'
  );

  -- Opp 03 (Em atendimento)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000003', v_workspace_id, 'd3300001-0000-4000-8000-000000000003', v_stage1_id, 'Cobertura Duplex Ponta Verde', 'open', null, 'Portal Imobiliário', 'Cobertura duplex vista mar',
    'Compra', 'Cobertura', 'Maceió / Ponta Verde', '1.5M - 2.0M', 500000.00, 'Curto prazo (90 dias)', 'Exige 3 vagas de garagem', 35000.00, 'not_analyzed', null, null, 'not_sent', now() - interval '3 days', now() - interval '26 hours'
  );

  -- Opp 04 (Em atendimento)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000004', v_workspace_id, 'd3300001-0000-4000-8000-000000000004', v_stage1_id, 'Lote 300m² Antares', 'open', null, 'Placa no Local', 'Lote plano pronto para construir',
    'Compra', 'Lote', 'Maceió / Antares', '180k - 220k', 30000.00, 'Médio prazo (6 meses)', 'Pergunta sobre receber veículo', null, 'not_analyzed', null, null, 'not_sent', now() - interval '5 days', now() - interval '3 days'
  );

  -- Opp 05 (Simulação / Análise)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000005', v_workspace_id, 'd3300001-0000-4000-8000-000000000005', v_stage2_id, 'Apê 3/4 Jatiúca', 'open', null, 'Indicação', 'Apartamento 3/4 com suíte',
    'Compra', 'Apartamento', 'Maceió / Jatiúca', '500k - 650k', 100000.00, 'Curto prazo (90 dias)', 'Próximo a colégios', 16500.00, 'in_analysis', null, 'Simulação Caixa enviada', 'pending', now() - interval '4 days', now() - interval '3 hours'
  );

  -- Opp 06 (Simulação / Análise)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000006', v_workspace_id, 'd3300001-0000-4000-8000-000000000006', v_stage2_id, 'Apê Pajuçara Perto da Praia', 'open', null, 'Site', 'Apartamento 2/4 Pajuçara',
    'Compra', 'Apartamento', 'Maceió / Pajuçara', '450k - 550k', 90000.00, 'Imediato (30 dias)', 'Interesse em Bradesco e Caixa', 12000.00, 'in_analysis', null, 'Aguardando parecer bancário', 'pending', now() - interval '2 days', now() - interval '20 minutes'
  );

  -- Opp 07 (Simulação / Análise)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000007', v_workspace_id, 'd3300001-0000-4000-8000-000000000007', v_stage2_id, 'Casa de Bairro em Gruta', 'open', null, 'Instagram Ads', 'Casa solta de bairro',
    'Compra', 'Casa', 'Maceió / Gruta', '380k - 450k', 70000.00, 'Curto prazo (90 dias)', 'Aceita reforma leve', 9500.00, 'conditioned', 350000.00, 'Exige quitação prévia de consignado', 'pending', now() - interval '6 days', now() - interval '36 hours'
  );

  -- Opp 08 (Documentação)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000008', v_workspace_id, 'd3300001-0000-4000-8000-000000000008', v_stage3_id, 'Loteamento Fechado Satuba', 'open', null, 'Indicação', 'Lote 250m² em condomínio',
    'Compra', 'Lote', 'Satuba', '140k - 180k', 25000.00, 'Imediato (30 dias)', 'Financiamento de lote + construção', 7200.00, 'approved', 135000.00, 'Crédito aprovado Caixa', 'pending', now() - interval '8 days', now() - interval '45 minutes'
  );

  -- Opp 09 (Documentação)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000009', v_workspace_id, 'd3300001-0000-4000-8000-000000000009', v_stage3_id, 'Sala Comercial Jatiúca', 'open', null, 'Portal Imobiliário', 'Sala comercial 40m²',
    'Compra', 'Sala Comercial', 'Maceió / Jatiúca', '280k - 350k', 80000.00, 'Curto prazo (90 dias)', 'Para consultório médico', 22000.00, 'approved', 250000.00, 'Aprovado Itaú', 'not_sent', now() - interval '10 days', now() - interval '5 days'
  );

  -- Opp 10 (Documentação)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000010', v_workspace_id, 'd3300001-0000-4000-8000-000000000010', v_stage3_id, 'Apê Quarto e Sala Cruz das Almas', 'open', null, 'WhatsApp Direct', 'Quarto e sala para investimento',
    'Compra', 'Apartamento', 'Maceió / Cruz das Almas', '230k - 280k', 80000.00, 'Imediato (30 dias)', 'Investimento em aluguel por temporada', 14000.00, 'approved', 180000.00, 'Aprovado Santander', 'complete', now() - interval '7 days', now() - interval '24 hours'
  );

  -- Opp 11 (Aprovado / Escolhendo imóvel)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000011', v_workspace_id, 'd3300001-0000-4000-8000-000000000011', v_stage4_id, 'Edifício Maresias 3/4 Pajuçara', 'open', null, 'Indicação', 'Apartamento 3/4 nascente',
    'Compra', 'Apartamento', 'Maceió / Pajuçara', '600k - 750k', 180000.00, 'Imediato (30 dias)', 'Deseja andar intermediário', 20000.00, 'approved', 520000.00, 'Aprovado Caixa 520k', 'complete', now() - interval '12 days', now() - interval '3 hours'
  );

  -- Opp 12 (Aprovado / Escolhendo imóvel)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000012', v_workspace_id, 'd3300001-0000-4000-8000-000000000012', v_stage4_id, 'Casa Condomínio Aldebaran', 'open', null, 'Site', 'Casa 4 suítes com piscina',
    'Compra', 'Casa em Condomínio', 'Maceió / Serraria', '900k - 1.2M', 300000.00, 'Curto prazo (90 dias)', 'Agendado visitas nas 2 opções', 28000.00, 'approved', 800000.00, 'Aprovado Bradesco', 'complete', now() - interval '14 days', now() - interval '48 hours'
  );

  -- Opp 13 (Aprovado / Escolhendo imóvel)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000013', v_workspace_id, 'd3300001-0000-4000-8000-000000000013', v_stage4_id, 'Lote 450m² Paripueira', 'open', null, 'Instagram Ads', 'Lote em loteamento de praia',
    'Compra', 'Lote', 'Paripueira', '200k - 260k', 50000.00, 'Médio prazo (6 meses)', 'Dúvida entre quadra B e quadra F', 11000.00, 'approved', 180000.00, 'Aprovado Banco do Brasil', 'complete', now() - interval '9 days', now() - interval '4 days'
  );

  -- Opp 14 (Negociação)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000014', v_workspace_id, 'd3300001-0000-4000-8000-000000000014', v_stage5_id, 'Apê 3/4 Beira-Mar Ponta Verde', 'open', null, 'WhatsApp Direct', 'Apartamento alto padrão beira-mar',
    'Compra', 'Apartamento', 'Maceió / Ponta Verde', '1.1M - 1.3M', 350000.00, 'Imediato (30 dias)', 'Proposta enviada de 1.18M', 32000.00, 'approved', 850000.00, 'Aprovado 850k Itaú', 'complete', now() - interval '15 days', now() - interval '6 hours'
  );

  -- Opp 15 (Negociação)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000015', v_workspace_id, 'd3300001-0000-4000-8000-000000000015', v_stage5_id, 'Terreno Comercial Av. Menino Marcelo', 'open', null, 'Indicação', 'Terreno para ponto comercial',
    'Compra', 'Lote', 'Maceió / Serraria', '850k - 1.0M', 400000.00, 'Curto prazo (90 dias)', 'Minuta em revisão jurídica', 45000.00, 'approved', 500000.00, 'Aprovado Santander', 'complete', now() - interval '16 days', now() - interval '24 hours'
  );

  -- Opp 16 (Contrato)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000016', v_workspace_id, 'd3300001-0000-4000-8000-000000000016', v_stage6_id, 'Apê 2/4 Stella Maris', 'open', null, 'Indicação', 'Apartamento 2/4 Stella Maris',
    'Compra', 'Apartamento', 'Maceió / Jatiúca', '420k - 480k', 100000.00, 'Imediato (30 dias)', 'Contrato bancário assinado enviado cartório', 15000.00, 'approved', 350000.00, 'Aprovado Caixa 350k', 'complete', now() - interval '20 days', now() - interval '2 hours'
  );

  -- Opp 17 (Contrato - Won / Ganho)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000017', v_workspace_id, 'd3300001-0000-4000-8000-000000000017', v_stage6_id, 'Casa Duplex Mangabeiras', 'won', now() - interval '10 days', 'Placa no Local', 'Casa duplex pronta morar',
    'Compra', 'Casa', 'Maceió / Mangabeiras', '800k - 950k', 270000.00, 'Imediato (30 dias)', 'Venda concluída chaves entregues', 25000.00, 'approved', 600000.00, 'Aprovado Bradesco', 'complete', now() - interval '30 days', now() - interval '10 days'
  );

  -- Opp 18 (Retrabalho - Rework)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, rework_reason, rework_reevaluation_date, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000018', v_workspace_id, 'd3300001-0000-4000-8000-000000000018', v_stage2_id, 'Apê 3/4 Mangabeiras (Retrabalho)', 'rework', null, 'Portal Imobiliário', 'Apê 3/4 com dependência',
    'Compra', 'Apartamento', 'Maceió / Mangabeiras', '400k - 500k', 80000.00, 'Médio prazo (6 meses)', 'Retorno agendado pós inventário', 'Aguardando inventário imóvel herança Bahia', now() + interval '60 days', 14000.00, 'in_analysis', null, 'Pendente inventário', 'pending', now() - interval '25 days', now() - interval '12 days'
  );

  -- Opp 19 (Perdido - Lost)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, loss_reason, loss_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000019', v_workspace_id, 'd3300001-0000-4000-8000-000000000019', v_stage2_id, 'Apê Quarto e Sala Ponta Verde (Perdido)', 'lost', now() - interval '15 days', 'Instagram Ads', 'Quarto e sala perto da praia',
    'Compra', 'Apartamento', 'Maceió / Ponta Verde', '220k - 260k', 30000.00, 'Curto prazo (90 dias)', 'Crédito reprovado por score', 'Reprovação de crédito bancário e score insuficiente', 'Recomendado movimentação bancária 6 meses', 5500.00, 'rejected', null, 'Reprovado análise risco', 'not_sent', now() - interval '22 days', now() - interval '15 days'
  );

  -- Opp 20 (Cancelado - Cancelled)
  insert into public.opportunities (
    id, workspace_id, contact_id, current_stage_id, title, status, closed_at, origin, property_summary,
    operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available,
    timeframe_intent, preferences_notes, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status, created_at, updated_at
  ) values (
    'd3300002-0000-4000-8000-000000000020', v_workspace_id, 'd3300001-0000-4000-8000-000000000020', v_stage1_id, 'Casa Comercial Farol (Cancelado)', 'cancelled', now() - interval '20 days', 'Site', 'Casa grande para clínica',
    'Aluguel', 'Casa Comercial', 'Maceió / Farol', '5k - 8k/mês', null, 'Investimento futuro', 'Desistência de expansão comercial', null, 'not_analyzed', null, null, 'not_sent', now() - interval '28 days', now() - interval '20 days'
  );


  -- 7. Inserir Registros Financeiros OWNER-only (Opportunity Financials)
  insert into public.opportunity_financials (id, workspace_id, opportunity_id, business_value, commission_expected, commission_received, created_at, updated_at)
  values ('d3300005-0000-4000-8000-000000000014', v_workspace_id, 'd3300002-0000-4000-8000-000000000014', 1200000.00, 60000.00, 0.00, now() - interval '15 days', now() - interval '6 hours');

  insert into public.opportunity_financials (id, workspace_id, opportunity_id, business_value, commission_expected, commission_received, created_at, updated_at)
  values ('d3300005-0000-4000-8000-000000000015', v_workspace_id, 'd3300002-0000-4000-8000-000000000015', 900000.00, 45000.00, 0.00, now() - interval '16 days', now() - interval '24 hours');

  insert into public.opportunity_financials (id, workspace_id, opportunity_id, business_value, commission_expected, commission_received, created_at, updated_at)
  values ('d3300005-0000-4000-8000-000000000016', v_workspace_id, 'd3300002-0000-4000-8000-000000000016', 450000.00, 22500.00, 11250.00, now() - interval '20 days', now() - interval '2 hours');

  insert into public.opportunity_financials (id, workspace_id, opportunity_id, business_value, commission_expected, commission_received, created_at, updated_at)
  values ('d3300005-0000-4000-8000-000000000017', v_workspace_id, 'd3300002-0000-4000-8000-000000000017', 870000.00, 43500.00, 43500.00, now() - interval '30 days', now() - interval '10 days');


  -- 8. Inserir Conversas, Participantes e Mensagens com Deltas Temporais Deliberados
  -- Conversa 01 (Lucas Gabriel - Equipe devendo resposta ~5 min)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000001', v_workspace_id, v_channel_id, 'thread_demo_01', 'individual', 'active', 'commercial', now() - interval '2 days', now() - interval '2 days', now() - interval '5 minutes');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000001', v_workspace_id, 'd3300003-0000-4000-8000-000000000001', 'd3300004-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '2 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000001', 'd3300003-0000-4000-8000-000000000001', v_owner_member_id, now() - interval '2 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000001', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000001', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000001', 'Olá, vi o anúncio do apê 2/4 no Farol. Ainda está disponível?', 'received', now() - interval '5 minutes', 'msg_demo_01_a', now() - interval '5 minutes', now() - interval '5 minutes', now() - interval '5 minutes');

  -- Conversa 02 (Amanda Maria - Equipe devendo resposta ~12 min)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000002', v_workspace_id, v_channel_id, 'thread_demo_02', 'individual', 'active', 'commercial', now() - interval '1 day', now() - interval '1 day', now() - interval '12 minutes');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000002', v_workspace_id, 'd3300003-0000-4000-8000-000000000002', 'd3300004-0000-4000-8000-000000000002', now() - interval '1 day', now() - interval '1 day');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000002', 'd3300003-0000-4000-8000-000000000002', v_owner_member_id, now() - interval '1 day');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000002', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000002', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000002', 'Boa tarde! Gostaria de saber o valor do condomínio da casa em Marechal.', 'received', now() - interval '12 minutes', 'msg_demo_02_a', now() - interval '12 minutes', now() - interval '12 minutes', now() - interval '12 minutes');

  -- Conversa 03 (Bruno Henrique - Equipe devendo resposta >24h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000003', v_workspace_id, v_channel_id, 'thread_demo_03', 'individual', 'active', 'commercial', now() - interval '3 days', now() - interval '3 days', now() - interval '26 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000003', v_workspace_id, 'd3300003-0000-4000-8000-000000000003', 'd3300004-0000-4000-8000-000000000003', now() - interval '3 days', now() - interval '3 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000003', 'd3300003-0000-4000-8000-000000000003', v_owner_member_id, now() - interval '3 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000003', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000003', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000003', 'Consegue agendar a visita na cobertura para este sábado às 10h?', 'received', now() - interval '26 hours', 'msg_demo_03_a', now() - interval '26 hours', now() - interval '26 hours', now() - interval '26 hours');

  -- Conversa 04 (Camila Rocha - Cliente devendo resposta >2 dias / Follow-up)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000004', v_workspace_id, v_channel_id, 'thread_demo_04', 'individual', 'active', 'commercial', now() - interval '5 days', now() - interval '5 days', now() - interval '3 days');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000004', v_workspace_id, 'd3300003-0000-4000-8000-000000000004', 'd3300004-0000-4000-8000-000000000004', now() - interval '5 days', now() - interval '5 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000004', 'd3300003-0000-4000-8000-000000000004', v_owner_member_id, now() - interval '5 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000004', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000004', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000004', 'Olá Camila! Verifiquei com o proprietário do lote em Antares: ele aceita avaliar um veículo como entrada. Qual o modelo do seu carro?', 'delivered', now() - interval '3 days', now() - interval '3 days');

  -- Conversa 05 (Diego Ramos - Cliente devendo resposta ~3h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000005', v_workspace_id, v_channel_id, 'thread_demo_05', 'individual', 'active', 'commercial', now() - interval '4 days', now() - interval '4 days', now() - interval '3 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000005', v_workspace_id, 'd3300003-0000-4000-8000-000000000005', 'd3300004-0000-4000-8000-000000000005', now() - interval '4 days', now() - interval '4 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000005', 'd3300003-0000-4000-8000-000000000005', v_owner_member_id, now() - interval '4 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000005', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000005', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000005', 'Diego, dei entrada na sua simulação na Caixa. A taxa estimada ficou em 9.5% a.a. Quer que eu simule também pelo Bradesco?', 'delivered', now() - interval '3 hours', now() - interval '3 hours');

  -- Conversa 06 (Elena Castro - Equipe devendo resposta ~20 min)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000006', v_workspace_id, v_channel_id, 'thread_demo_06', 'individual', 'active', 'commercial', now() - interval '2 days', now() - interval '2 days', now() - interval '20 minutes');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000006', v_workspace_id, 'd3300003-0000-4000-8000-000000000006', 'd3300004-0000-4000-8000-000000000006', now() - interval '2 days', now() - interval '2 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000006', 'd3300003-0000-4000-8000-000000000006', v_owner_member_id, now() - interval '2 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000006', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000006', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000006', 'Conseguiu simular o apartamento de Pajuçara pelo Bradesco?', 'received', now() - interval '20 minutes', 'msg_demo_06_a', now() - interval '20 minutes', now() - interval '20 minutes', now() - interval '20 minutes');

  -- Conversa 07 (Fernando Augusto - Equipe devendo resposta >24h ~36h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000007', v_workspace_id, v_channel_id, 'thread_demo_07', 'individual', 'active', 'commercial', now() - interval '6 days', now() - interval '6 days', now() - interval '36 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000007', v_workspace_id, 'd3300003-0000-4000-8000-000000000007', 'd3300004-0000-4000-8000-000000000007', now() - interval '6 days', now() - interval '6 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000007', 'd3300003-0000-4000-8000-000000000007', v_owner_member_id, now() - interval '6 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000007', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000007', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000007', 'Já Quitei o empréstimo consignado ontem. Como faço para enviar o comprovante?', 'received', now() - interval '36 hours', 'msg_demo_07_a', now() - interval '36 hours', now() - interval '36 hours', now() - interval '36 hours');

  -- Conversa 08 (Gabriela Nogueira - Equipe devendo resposta ~45 min)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000008', v_workspace_id, v_channel_id, 'thread_demo_08', 'individual', 'active', 'commercial', now() - interval '8 days', now() - interval '8 days', now() - interval '45 minutes');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000008', v_workspace_id, 'd3300003-0000-4000-8000-000000000008', 'd3300004-0000-4000-8000-000000000008', now() - interval '8 days', now() - interval '8 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000008', 'd3300003-0000-4000-8000-000000000008', v_owner_member_id, now() - interval '8 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000008', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000008', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000008', 'Peguei a certidão de casamento atualizada no cartório! Posso mandar em PDF?', 'received', now() - interval '45 minutes', 'msg_demo_08_a', now() - interval '45 minutes', now() - interval '45 minutes', now() - interval '45 minutes');

  -- Conversa 09 (Heitor Alencar - Cliente devendo resposta >2 dias / Follow-up há 5 dias)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000009', v_workspace_id, v_channel_id, 'thread_demo_09', 'individual', 'active', 'commercial', now() - interval '10 days', now() - interval '10 days', now() - interval '5 days');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000009', v_workspace_id, 'd3300003-0000-4000-8000-000000000009', 'd3300004-0000-4000-8000-000000000009', now() - interval '10 days', now() - interval '10 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000009', 'd3300003-0000-4000-8000-000000000009', v_owner_member_id, now() - interval '10 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000009', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000009', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000009', 'Heitor, boa tarde! Conseguiu emitir os 3 últimos extratos bancários para anexarmos no processo da sala comercial?', 'delivered', now() - interval '5 days', now() - interval '5 days');

  -- Conversa 10 (Isabela Maria - Cliente devendo resposta ~1 dia ~24h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000010', v_workspace_id, v_channel_id, 'thread_demo_10', 'individual', 'active', 'commercial', now() - interval '7 days', now() - interval '7 days', now() - interval '24 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000010', v_workspace_id, 'd3300003-0000-4000-8000-000000000010', 'd3300004-0000-4000-8000-000000000010', now() - interval '7 days', now() - interval '7 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000010', 'd3300003-0000-4000-8000-000000000010', v_owner_member_id, now() - interval '7 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000010', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000010', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000010', 'Documentos 100% aprovados Isabela! Podemos avançar para a reserva da unidade quarto e sala em Cruz das Almas.', 'delivered', now() - interval '24 hours', now() - interval '24 hours');

  -- Conversa 11 (João Pedro - Equipe devendo resposta ~3h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000011', v_workspace_id, v_channel_id, 'thread_demo_11', 'individual', 'active', 'commercial', now() - interval '12 days', now() - interval '12 days', now() - interval '3 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000011', v_workspace_id, 'd3300003-0000-4000-8000-000000000011', 'd3300004-0000-4000-8000-000000000011', now() - interval '12 days', now() - interval '12 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000011', 'd3300003-0000-4000-8000-000000000011', v_owner_member_id, now() - interval '12 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000011', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000011', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000011', 'Gostei muito da unidade 402 no Edifício Maresias! É possível negociar o porcelanato com a construtora?', 'received', now() - interval '3 hours', 'msg_demo_11_a', now() - interval '3 hours', now() - interval '3 hours', now() - interval '3 hours');

  -- Conversa 12 (Larissa Beatriz - Cliente devendo resposta ~2 dias ~48h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000012', v_workspace_id, v_channel_id, 'thread_demo_12', 'individual', 'active', 'commercial', now() - interval '14 days', now() - interval '14 days', now() - interval '48 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000012', v_workspace_id, 'd3300003-0000-4000-8000-000000000012', 'd3300004-0000-4000-8000-000000000012', now() - interval '14 days', now() - interval '14 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000012', 'd3300003-0000-4000-8000-000000000012', v_owner_member_id, now() - interval '14 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000012', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000012', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000012', 'Larissa, confirmo nossa visita às 2 casas do Aldebaran para amanhã às 15h. Seu marido conseguirá ir junto?', 'delivered', now() - interval '48 hours', now() - interval '48 hours');

  -- Conversa 13 (Marcelo Tavira - Cliente devendo resposta >2 dias / Follow-up há 4 dias)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000013', v_workspace_id, v_channel_id, 'thread_demo_13', 'individual', 'active', 'commercial', now() - interval '9 days', now() - interval '9 days', now() - interval '4 days');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000013', v_workspace_id, 'd3300003-0000-4000-8000-000000000013', 'd3300004-0000-4000-8000-000000000013', now() - interval '9 days', now() - interval '9 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000013', 'd3300003-0000-4000-8000-000000000013', v_owner_member_id, now() - interval '9 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000013', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000013', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000013', 'Marcelo, levantei a topografia da quadra B e da quadra F. A quadra F tem melhor elevação e menor custo de aterro.', 'delivered', now() - interval '4 days', now() - interval '4 days');

  -- Conversa 14 (Natalia Farias - Equipe devendo resposta ~6h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000014', v_workspace_id, v_channel_id, 'thread_demo_14', 'individual', 'active', 'commercial', now() - interval '15 days', now() - interval '15 days', now() - interval '6 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000014', v_workspace_id, 'd3300003-0000-4000-8000-000000000014', 'd3300004-0000-4000-8000-000000000014', now() - interval '15 days', now() - interval '15 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000014', 'd3300003-0000-4000-8000-000000000014', v_owner_member_id, now() - interval '15 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000014', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000014', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000014', 'Consegui alinhar com meu sócio: se fecharmos em 1.180.000 nós enviamos a proposta assinada hoje!', 'received', now() - interval '6 hours', 'msg_demo_14_a', now() - interval '6 hours', now() - interval '6 hours', now() - interval '6 hours');

  -- Conversa 15 (Otavio Augusto - Cliente devendo resposta ~1 dia ~24h)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000015', v_workspace_id, v_channel_id, 'thread_demo_15', 'individual', 'active', 'commercial', now() - interval '16 days', now() - interval '16 days', now() - interval '24 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000015', v_workspace_id, 'd3300003-0000-4000-8000-000000000015', 'd3300004-0000-4000-8000-000000000015', now() - interval '16 days', now() - interval '16 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000015', 'd3300003-0000-4000-8000-000000000015', v_owner_member_id, now() - interval '16 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000015', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000015', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000015', 'Otávio, a minuta do contrato comercial do terreno na Serraria foi encaminhada para seu e-mail.', 'delivered', now() - interval '24 hours', now() - interval '24 hours');

  -- Conversa 16 (Patricia Carneiro - Equipe devendo resposta ~2 horas)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000016', v_workspace_id, v_channel_id, 'thread_demo_16', 'individual', 'active', 'commercial', now() - interval '20 days', now() - interval '20 days', now() - interval '2 hours');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000016', v_workspace_id, 'd3300003-0000-4000-8000-000000000016', 'd3300004-0000-4000-8000-000000000016', now() - interval '20 days', now() - interval '20 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000016', 'd3300003-0000-4000-8000-000000000016', v_owner_member_id, now() - interval '20 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000016', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000016', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000016', 'Já dei entrada com o contrato no cartório do 2º ofício! Quanto tempo leva para registrar?', 'received', now() - interval '2 hours', 'msg_demo_16_a', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours');

  -- Conversa 17 (Rafael Medeiros - Won / Ganho)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, archived_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000017', v_workspace_id, v_channel_id, 'thread_demo_17', 'individual', 'archived', 'commercial', now() - interval '30 days', now() - interval '5 days', now() - interval '30 days', now() - interval '5 days');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000017', v_workspace_id, 'd3300003-0000-4000-8000-000000000017', 'd3300004-0000-4000-8000-000000000017', now() - interval '30 days', now() - interval '30 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000017', 'd3300003-0000-4000-8000-000000000017', v_owner_member_id, now() - interval '30 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000017', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000017', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000017', 'Parabéns pela aquisição da casa duplex na Mangabeiras, Rafael! Chaves entregues.', 'delivered', now() - interval '5 days', now() - interval '5 days');

  -- Conversa 18 (Sofia Helena - Retrabalho)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000018', v_workspace_id, v_channel_id, 'thread_demo_18', 'individual', 'active', 'commercial', now() - interval '25 days', now() - interval '25 days', now() - interval '12 days');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000018', v_workspace_id, 'd3300003-0000-4000-8000-000000000018', 'd3300004-0000-4000-8000-000000000018', now() - interval '25 days', now() - interval '25 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000018', 'd3300003-0000-4000-8000-000000000018', v_owner_member_id, now() - interval '25 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000018', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000018', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000018', 'Perfeito Sofia. Deixei agendado o retorno da nossa conversa para Outubro após a finalização do inventário.', 'delivered', now() - interval '12 days', now() - interval '12 days');

  -- Conversa 19 (Thiago Vinicius - Perdido)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, archived_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000019', v_workspace_id, v_channel_id, 'thread_demo_19', 'individual', 'archived', 'commercial', now() - interval '22 days', now() - interval '15 days', now() - interval '22 days', now() - interval '15 days');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000019', v_workspace_id, 'd3300003-0000-4000-8000-000000000019', 'd3300004-0000-4000-8000-000000000019', now() - interval '22 days', now() - interval '22 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000019', 'd3300003-0000-4000-8000-000000000019', v_owner_member_id, now() - interval '22 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, internal_author_member_id, client_idempotency_key, text_content, status, occurred_at, created_at)
  values ('d3300007-0000-4000-8000-000000000019', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000019', 'outgoing', 'crm', v_owner_member_id, 'd3300007-0000-4000-8000-000000000019', 'Thiago, infelizmente a análise de crédito foi indeferida pelo banco no momento devido ao score. Recomendamos movimentação bancária por 6 meses.', 'delivered', now() - interval '15 days', now() - interval '15 days');

  -- Conversa 20 (Vanessa Cristina - Cancelado)
  insert into public.conversations (id, workspace_id, channel_connection_id, external_thread_id, conversation_type, operational_status, visibility, started_at, archived_at, created_at, updated_at)
  values ('d3300003-0000-4000-8000-000000000020', v_workspace_id, v_channel_id, 'thread_demo_20', 'individual', 'archived', 'commercial', now() - interval '28 days', now() - interval '20 days', now() - interval '28 days', now() - interval '20 days');
  insert into public.conversation_participants (id, workspace_id, conversation_id, contact_point_id, first_seen_at, created_at)
  values ('d3300006-0000-4000-8000-000000000020', v_workspace_id, 'd3300003-0000-4000-8000-000000000020', 'd3300004-0000-4000-8000-000000000020', now() - interval '28 days', now() - interval '28 days');
  insert into public.opportunity_conversations (workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
  values (v_workspace_id, 'd3300002-0000-4000-8000-000000000020', 'd3300003-0000-4000-8000-000000000020', v_owner_member_id, now() - interval '28 days');

  insert into public.messages (id, workspace_id, channel_connection_id, conversation_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_message_id, external_created_at, received_at, created_at)
  values ('d3300007-0000-4000-8000-000000000020', v_workspace_id, v_channel_id, 'd3300003-0000-4000-8000-000000000020', 'incoming', 'whatsapp', 'd3300004-0000-4000-8000-000000000020', 'Decidimos suspender o projeto de aluguel comercial por enquanto. Obrigado pelo atendimento.', 'received', now() - interval '20 days', 'msg_demo_20_a', now() - interval '20 days', now() - interval '20 days', now() - interval '20 days');

  -- 9. Registrar Histórico em Pipeline History para Rastreabilidade
  insert into public.pipeline_history (id, workspace_id, opportunity_id, previous_stage_id, new_stage_id, changed_by_member_id, changed_at)
  values ('d3300008-0000-4000-8000-000000000001', v_workspace_id, 'd3300002-0000-4000-8000-000000000005', v_stage1_id, v_stage2_id, v_owner_member_id, now() - interval '3 days');

  insert into public.pipeline_history (id, workspace_id, opportunity_id, previous_stage_id, new_stage_id, changed_by_member_id, changed_at)
  values ('d3300008-0000-4000-8000-000000000002', v_workspace_id, 'd3300002-0000-4000-8000-000000000008', v_stage2_id, v_stage3_id, v_owner_member_id, now() - interval '6 days');

  insert into public.pipeline_history (id, workspace_id, opportunity_id, previous_stage_id, new_stage_id, changed_by_member_id, changed_at)
  values ('d3300008-0000-4000-8000-000000000003', v_workspace_id, 'd3300002-0000-4000-8000-000000000011', v_stage3_id, v_stage4_id, v_owner_member_id, now() - interval '8 days');

  insert into public.pipeline_history (id, workspace_id, opportunity_id, previous_stage_id, new_stage_id, changed_by_member_id, changed_at)
  values ('d3300008-0000-4000-8000-000000000004', v_workspace_id, 'd3300002-0000-4000-8000-000000000014', v_stage4_id, v_stage5_id, v_owner_member_id, now() - interval '10 days');

  insert into public.pipeline_history (id, workspace_id, opportunity_id, previous_stage_id, new_stage_id, changed_by_member_id, changed_at)
  values ('d3300008-0000-4000-8000-000000000005', v_workspace_id, 'd3300002-0000-4000-8000-000000000016', v_stage5_id, v_stage6_id, v_owner_member_id, now() - interval '12 days');

end $$;
