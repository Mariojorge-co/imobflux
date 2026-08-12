-- ImobFlux Sprint 22: Limpeza Cirúrgica dos Dados do Demo Mode
-- Execução Fail-Closed restrita ao banco PostgreSQL local do ImobFlux

set search_path to public, extensions, pg_catalog;

do $$
declare
  v_server_addr text := inet_server_addr()::text;
  v_database text := current_database();
begin

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

  -- 2. Deletar dados de Oportunidade e Financeiro OWNER-only
  if to_regclass('public.conversation_read_states') is not null then
    delete from public.conversation_read_states
    where id = 'd3400009-0000-4000-8000-000000000001'
       or conversation_id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000022';
  end if;

  if to_regclass('public.work_tasks') is not null then
    delete from public.work_tasks
    where id between 'd340000a-0000-4000-8000-000000000001' and 'd340000a-0000-4000-8000-000000000002'
       or contact_id between 'd3300001-0000-4000-8000-000000000001' and 'd3300001-0000-4000-8000-000000000020'
       or opportunity_id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020'
       or conversation_id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000022';
  end if;

  if to_regclass('public.internal_notes') is not null then
    delete from public.internal_notes
    where contact_id between 'd3300001-0000-4000-8000-000000000001' and 'd3300001-0000-4000-8000-000000000020'
       or opportunity_id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020'
       or conversation_id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000022';
  end if;

  if to_regclass('public.opportunity_financials') is not null then
    delete from public.opportunity_financials
    where opportunity_id in (
      select id from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020'
    );
  end if;

  if to_regclass('public.pipeline_history') is not null then
    execute 'alter table public.pipeline_history disable trigger trg_pipeline_history_prevent_mutation';

    delete from public.pipeline_history
    where opportunity_id in (
      select id from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020'
    );

    execute 'alter table public.pipeline_history enable trigger trg_pipeline_history_prevent_mutation';
  end if;

  if to_regclass('public.opportunity_conversations') is not null then
    delete from public.opportunity_conversations
    where opportunity_id in (
      select id from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020'
    );
  end if;

  if to_regclass('public.opportunities') is not null then
    delete from public.opportunities
    where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020';
  end if;

  -- 3. Deletar Mensagens, Participantes e Conversas
  if to_regclass('public.messages') is not null then
    delete from public.messages
    where conversation_id in (
      select id from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000022'
    );
  end if;

  if to_regclass('public.conversation_participants') is not null then
    delete from public.conversation_participants
    where conversation_id in (
      select id from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000022'
    );
  end if;

  if to_regclass('public.conversation_assignments') is not null then
    delete from public.conversation_assignments
    where conversation_id in (
      select id from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000022'
    );
  end if;

  if to_regclass('public.conversations') is not null then
    delete from public.conversations
    where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000022';
  end if;

  -- 4. Deletar Pontos de Contato e Contatos
  if to_regclass('public.contact_points') is not null then
    delete from public.contact_points
    where contact_id in (
      select id from public.contacts where id between 'd3300001-0000-4000-8000-000000000001' and 'd3300001-0000-4000-8000-000000000020'
    );
  end if;

  if to_regclass('public.contacts') is not null then
    delete from public.contacts
    where id between 'd3300001-0000-4000-8000-000000000001' and 'd3300001-0000-4000-8000-000000000020';
  end if;

  -- 5. Deletar Conexão de Canal Simulado
  if to_regclass('public.channel_connections') is not null then
    delete from public.channel_connections
    where external_account_id = 'imobflux_demo_instance';
  end if;

end $$;
