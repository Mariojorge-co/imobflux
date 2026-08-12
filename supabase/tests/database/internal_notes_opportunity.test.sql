begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;
select plan(14);

insert into auth.users (id, email)
values
  ('b2200000-0000-4000-8000-000000000001', 'notes-owner-a@example.test'),
  ('b2200000-0000-4000-8000-000000000002', 'notes-attendant-a@example.test'),
  ('b2200000-0000-4000-8000-000000000003', 'notes-owner-b@example.test');

insert into public.workspaces (id, name, status, timezone)
values
  ('b2200001-0000-4000-8000-000000000001', 'Notas Workspace A', 'active', 'America/Maceio'),
  ('b2200001-0000-4000-8000-000000000002', 'Notas Workspace B', 'active', 'America/Maceio');

insert into public.app_users (id, auth_user_id, display_name, status)
values
  ('b2200002-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'Owner Notas A', 'active'),
  ('b2200002-0000-4000-8000-000000000002', 'b2200000-0000-4000-8000-000000000002', 'Attendant Notas A', 'active'),
  ('b2200002-0000-4000-8000-000000000003', 'b2200000-0000-4000-8000-000000000003', 'Owner Notas B', 'active');

insert into public.workspace_members (
  id, workspace_id, user_id, role, status, activated_at, invited_by_member_id
)
values
  ('b2200003-0000-4000-8000-000000000001', 'b2200001-0000-4000-8000-000000000001', 'b2200002-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
  ('b2200003-0000-4000-8000-000000000002', 'b2200001-0000-4000-8000-000000000001', 'b2200002-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b2200003-0000-4000-8000-000000000001'),
  ('b2200003-0000-4000-8000-000000000003', 'b2200001-0000-4000-8000-000000000002', 'b2200002-0000-4000-8000-000000000003', 'owner', 'active', now(), null);

select public.provision_default_pipeline_stages('b2200001-0000-4000-8000-000000000001');
select public.provision_default_pipeline_stages('b2200001-0000-4000-8000-000000000002');

insert into public.channel_connections (
  id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at
)
values (
  'b2200004-0000-4000-8000-000000000001',
  'b2200001-0000-4000-8000-000000000001',
  'whatsapp', 'notes-account-a', '+5582999992200', 'active', now()
);

insert into public.contacts (id, workspace_id, classification, display_name, operational_status)
values
  ('b2200005-0000-4000-8000-000000000001', 'b2200001-0000-4000-8000-000000000001', 'lead', 'Contato Notas A1', 'active'),
  ('b2200005-0000-4000-8000-000000000002', 'b2200001-0000-4000-8000-000000000001', 'lead', 'Contato Notas A2', 'active'),
  ('b2200005-0000-4000-8000-000000000003', 'b2200001-0000-4000-8000-000000000002', 'lead', 'Contato Notas B1', 'active');

insert into public.contact_points (
  id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status
)
values (
  'b2200006-0000-4000-8000-000000000001',
  'b2200001-0000-4000-8000-000000000001',
  'b2200005-0000-4000-8000-000000000001',
  'phone', '+5582999992201', '(82) 99999-2201', 'active'
);

insert into public.opportunities (
  id, workspace_id, contact_id, current_stage_id, title, status
)
values
  (
    'b2200007-0000-4000-8000-000000000001',
    'b2200001-0000-4000-8000-000000000001',
    'b2200005-0000-4000-8000-000000000001',
    (select id from public.pipeline_stages where workspace_id = 'b2200001-0000-4000-8000-000000000001' order by position limit 1),
    'Oportunidade Notas A1', 'open'
  ),
  (
    'b2200007-0000-4000-8000-000000000002',
    'b2200001-0000-4000-8000-000000000001',
    'b2200005-0000-4000-8000-000000000002',
    (select id from public.pipeline_stages where workspace_id = 'b2200001-0000-4000-8000-000000000001' order by position limit 1),
    'Oportunidade Notas A2', 'open'
  ),
  (
    'b2200007-0000-4000-8000-000000000003',
    'b2200001-0000-4000-8000-000000000002',
    'b2200005-0000-4000-8000-000000000003',
    (select id from public.pipeline_stages where workspace_id = 'b2200001-0000-4000-8000-000000000002' order by position limit 1),
    'Oportunidade Notas B1', 'open'
  );

insert into public.conversations (
  id, workspace_id, channel_connection_id, external_thread_id,
  conversation_type, visibility, operational_status, started_at
)
values (
  'b2200008-0000-4000-8000-000000000001',
  'b2200001-0000-4000-8000-000000000001',
  'b2200004-0000-4000-8000-000000000001',
  'notes-thread-a1', 'individual', 'commercial', 'active', now()
);

insert into public.conversation_participants (
  workspace_id, conversation_id, contact_point_id, first_seen_at
)
values (
  'b2200001-0000-4000-8000-000000000001',
  'b2200008-0000-4000-8000-000000000001',
  'b2200006-0000-4000-8000-000000000001', now()
);

update public.contacts
set created_at = now() - interval '2 hours',
    updated_at = now(),
    commercial_visible_from = now() - interval '1 hour'
where id = 'b2200005-0000-4000-8000-000000000001';
update public.contact_points
set created_at = now() - interval '2 hours',
    updated_at = now(),
    commercial_visible_from = now() - interval '1 hour'
where id = 'b2200006-0000-4000-8000-000000000001';
update public.conversations
set commercial_visible_from = now()
where id = 'b2200008-0000-4000-8000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = 'b2200000-0000-4000-8000-000000000001';

select set_config(
  'test.general_note_id',
  public.save_internal_note(
    'b2200008-0000-4000-8000-000000000001',
    'Nota geral da conversa'
  )->>'note_id',
  true
);
select ok(
  current_setting('test.general_note_id', true) is not null,
  'RPC permite salvar nota sem opportunity_id'
);

select set_config(
  'test.opportunity_note_id',
  public.save_internal_note(
    'b2200008-0000-4000-8000-000000000001',
    'Nota da oportunidade correta',
    'b2200007-0000-4000-8000-000000000001'
  )->>'note_id',
  true
);
select results_eq(
  'select conversation_id::text || ''|'' || opportunity_id::text from public.internal_notes where id = '''
    || current_setting('test.opportunity_note_id', true) || '''',
  array['b2200008-0000-4000-8000-000000000001|b2200007-0000-4000-8000-000000000001'],
  'RPC salva conversation_id e opportunity_id válidos na mesma nota'
);

select throws_ok(
  $$select public.save_internal_note(
    'b2200008-0000-4000-8000-000000000001',
    'Associação cruzada de contato',
    'b2200007-0000-4000-8000-000000000002'
  )$$,
  'P0001',
  'Oportunidade não pertence ao contato da conversa.',
  'RPC rejeita oportunidade de outro contato no mesmo workspace'
);

select throws_ok(
  $$select public.save_internal_note(
    'b2200008-0000-4000-8000-000000000001',
    'Associação cruzada de workspace',
    'b2200007-0000-4000-8000-000000000003'
  )$$,
  'P0001',
  'Oportunidade não encontrada no workspace da conversa.',
  'RPC rejeita oportunidade de outro workspace'
);

set local "request.jwt.claim.sub" = 'b2200000-0000-4000-8000-000000000002';
select ok(
  public.save_internal_note(
    'b2200008-0000-4000-8000-000000000001',
    'Nota criada pelo attendant',
    'b2200007-0000-4000-8000-000000000001'
  )->>'note_id' is not null,
  'ATTENDANT ativo pode salvar nota dentro das regras do workspace'
);

select throws_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, conversation_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000002',
    'Insert direto proibido',
    'b2200008-0000-4000-8000-000000000001'
  )$$,
  '42501',
  null,
  'INSERT direto em internal_notes continua negado para authenticated'
);

reset role;

select lives_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, contact_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint: somente contato',
    'b2200005-0000-4000-8000-000000000001'
  )$$,
  'Constraint permite somente contact_id'
);

select lives_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, opportunity_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint: somente oportunidade',
    'b2200007-0000-4000-8000-000000000001'
  )$$,
  'Constraint permite somente opportunity_id'
);

select lives_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, conversation_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint: somente conversa',
    'b2200008-0000-4000-8000-000000000001'
  )$$,
  'Constraint permite somente conversation_id'
);

select lives_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, conversation_id, opportunity_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint: conversa e oportunidade',
    'b2200008-0000-4000-8000-000000000001',
    'b2200007-0000-4000-8000-000000000001'
  )$$,
  'Constraint permite conversation_id + opportunity_id'
);

select throws_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, contact_id, conversation_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint inválida contato e conversa',
    'b2200005-0000-4000-8000-000000000001',
    'b2200008-0000-4000-8000-000000000001'
  )$$,
  '23514', null,
  'Constraint rejeita contact_id + conversation_id'
);

select throws_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, contact_id, opportunity_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint inválida contato e oportunidade',
    'b2200005-0000-4000-8000-000000000001',
    'b2200007-0000-4000-8000-000000000001'
  )$$,
  '23514', null,
  'Constraint rejeita contact_id + opportunity_id'
);

select throws_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content, contact_id, opportunity_id, conversation_id
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint inválida com três contextos',
    'b2200005-0000-4000-8000-000000000001',
    'b2200007-0000-4000-8000-000000000001',
    'b2200008-0000-4000-8000-000000000001'
  )$$,
  '23514', null,
  'Constraint rejeita os três contextos simultaneamente'
);

select throws_ok(
  $$insert into public.internal_notes (
    workspace_id, author_member_id, content
  ) values (
    'b2200001-0000-4000-8000-000000000001',
    'b2200003-0000-4000-8000-000000000001',
    'Constraint inválida sem contexto'
  )$$,
  '23514', null,
  'Constraint rejeita todos os contextos nulos'
);

select finish();
rollback;
