begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(15);

-- ─── SETUP INICIAL DE FIXTURES (COMO SUPERUSER/POSTGRES) ─────────────────────

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'owner19@test.com'),
  ('10000000-0000-4000-8000-000000000002', 'attendant19@test.com')
on conflict (id) do nothing;

insert into public.app_users (id, auth_user_id, display_name, status)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Owner 19', 'active'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Attendant 19', 'active')
on conflict (id) do nothing;

insert into public.workspaces (id, name, status, timezone)
values ('10000000-0000-4000-8000-000000000001', 'Workspace Teste 19', 'active', 'America/Maceio')
on conflict do nothing;

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'attendant', 'active', now(), '30000000-0000-4000-8000-000000000001')
on conflict do nothing;

-- Inserir Etapas
insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Prospecção 19', 1, true, 'prospecting'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Proposta 19', 2, true, 'proposal')
on conflict do nothing;

-- Inserir Contatos
insert into public.contacts (id, workspace_id, display_name, classification, operational_status)
values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Contato Elegivel 19', 'client', 'active'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Contato Inelegivel 19', 'lead', 'active')
on conflict do nothing;

-- Inserir Contact Point apenas para o Contato Elegível
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status)
values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'phone',
  '+5582999990019',
  '(82) 99999-0019',
  'active'
) on conflict do nothing;

-- Inserir Channel Connection ativo
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'whatsapp',
  'account_19',
  '+5582988880019',
  'active',
  now()
) on conflict do nothing;

-- Inserir Oportunidades
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status)
values
  ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Oportunidade Teste 19', 'open'),
  ('80000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 'Oportunidade Inelegivel 19', 'open')
on conflict do nothing;

-- ─── EXECUÇÃO DOS TESTES COMO MEMBRO AUTENTICADO ─────────────────────────────

-- Simula sessão de OWNER (sub = auth_user_id do Owner 19)
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000001"}';

-- ─── 1. TESTES DE EDIÇÃO DE OPORTUNIDADE (update_opportunity) ─────────────────

select is(
  (public.update_opportunity(
    '80000000-0000-4000-8000-000000000001',
    'Titulo Editado 19',
    'Descricao editada',
    '40000000-0000-4000-8000-000000000002',
    null,
    '30000000-0000-4000-8000-000000000001'
  ))->>'status',
  'success',
  'update_opportunity edita titulo, descricao, etapa e responsavel com sucesso'
);

select is(
  (select title from public.opportunities where id = '80000000-0000-4000-8000-000000000001'),
  'Titulo Editado 19',
  'Titulo foi persistido corretamente no banco'
);

select ok(
  exists (
    select 1 from public.pipeline_history
    where opportunity_id = '80000000-0000-4000-8000-000000000001'
      and new_stage_id = '40000000-0000-4000-8000-000000000002'
  ),
  'pipeline_history registrou a alteracao de etapa'
);

select ok(
  exists (
    select 1 from public.audit_events
    where action = 'opportunity.updated'
      and target_id = '80000000-0000-4000-8000-000000000001'
  ),
  'audit_events registrou a atualizacao'
);

-- ─── 2. TESTES DE ELEGIBILIDADE E CRIAÇÃO DE CONVERSA ─────────────────────────

-- Oportunidade 2 (Inelegível — Contato sem telefone WhatsApp)
select is(
  (public.get_or_create_opportunity_conversation('80000000-0000-4000-8000-000000000002'))->>'status',
  'NO_ELIGIBLE_CONVERSATION',
  'Retorna NO_ELIGIBLE_CONVERSATION quando contato nao possui WhatsApp'
);

select is(
  (select count(*) from public.opportunity_conversations where opportunity_id = '80000000-0000-4000-8000-000000000002'),
  0::bigint,
  'Nenhuma escrita efetuada em opportunity_conversations quando inelegivel'
);

-- Oportunidade 1 (Elegível — Contato possui phone active e canal ativo)
select is(
  (public.get_or_create_opportunity_conversation('80000000-0000-4000-8000-000000000001'))->>'status',
  'created',
  'Cria conversa e vinculo atomicamente quando contato e canal sao elegiveis'
);

select ok(
  exists (
    select 1 from public.opportunity_conversations
    where opportunity_id = '80000000-0000-4000-8000-000000000001'
      and unlinked_at is null
  ),
  'Vinculo ativo registrado em opportunity_conversations'
);

-- Re-execução (Idempotência / Passo A)
select is(
  (public.get_or_create_opportunity_conversation('80000000-0000-4000-8000-000000000001'))->>'status',
  'success',
  'Segunda chamada retorna vinculo existente sem duplicar conversa'
);

-- ─── 3. TESTE DE BLOQUEIO DE TROCA DE CONTATO ─────────────────────────────────

select is(
  (public.update_opportunity(
    '80000000-0000-4000-8000-000000000001',
    'Titulo Editado 19',
    null,
    null,
    '50000000-0000-4000-8000-000000000002',
    null
  ))->>'status',
  'CONTACT_CHANGE_BLOCKED_BY_CONVERSATION',
  'Bloqueia troca do contato principal se a oportunidade tiver conversa vinculada'
);

select is(
  (select contact_id from public.opportunities where id = '80000000-0000-4000-8000-000000000001'),
  '50000000-0000-4000-8000-000000000001'::uuid,
  'Contato original foi mantido inalterado'
);

-- ─── 4. TESTES DE INTEGRAÇÃO BIDIRECIONAL (Conversas → Kanban) ────────────────

select is(
  (select (public.get_opportunity_for_conversation(
    (select conversation_id from public.opportunity_conversations where opportunity_id = '80000000-0000-4000-8000-000000000001' limit 1)
  ))->>'title'),
  'Titulo Editado 19',
  'get_opportunity_for_conversation resolve a oportunidade vinculada à conversa'
);

-- ─── 5. TESTES DE ARQUIVAMENTO LÓGICO (archive_opportunity) ──────────────────

select is(
  (public.archive_opportunity('80000000-0000-4000-8000-000000000001'))->>'status',
  'success',
  'archive_opportunity executa arquivamento logico com sucesso'
);

select ok(
  (select archived_at is not null from public.opportunities where id = '80000000-0000-4000-8000-000000000001'),
  'Oportunidade possui archived_at preenchido'
);

select ok(
  exists (
    select 1 from public.audit_events
    where action = 'opportunity.archived'
      and target_id = '80000000-0000-4000-8000-000000000001'
  ),
  'Evento de auditoria registrou o arquivamento'
);

-- ─── FINALIZAÇÃO ──────────────────────────────────────────────────────────────

select * from finish();
rollback;
