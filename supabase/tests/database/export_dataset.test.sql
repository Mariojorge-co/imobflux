begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(27);

-- ─── Fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
    ('b5500000-0000-4000-8000-000000000001', 'ex-owner@example.test'),
    ('b5500000-0000-4000-8000-000000000002', 'ex-a@example.test'),
    ('b5500000-0000-4000-8000-000000000009', 'ex-other-owner@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5500001-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001', 'EX Owner', 'active'),
    ('b5500001-0000-4000-8000-000000000002', 'b5500000-0000-4000-8000-000000000002', 'EX Atendente A', 'active'),
    ('b5500001-0000-4000-8000-000000000009', 'b5500000-0000-4000-8000-000000000009', 'EX Outro Owner', 'active');

insert into public.workspaces (id, name, status, timezone)
values
    ('b5500002-0000-4000-8000-000000000001', 'EX Workspace', 'active', 'America/Maceio'),
    ('b5500002-0000-4000-8000-000000000009', 'EX Outro Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5500003-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000001', 'b5500001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5500003-0000-4000-8000-000000000002', 'b5500002-0000-4000-8000-000000000001', 'b5500001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5500003-0000-4000-8000-000000000001'),
    ('b5500003-0000-4000-8000-000000000009', 'b5500002-0000-4000-8000-000000000009', 'b5500001-0000-4000-8000-000000000009', 'owner', 'active', now(), null);

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5500004-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000001', 'whatsapp', 'ex_instance', '+5582999905500', 'active', now());

insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values ('b5500005-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000001', 'EX Etapa Visita', 1, true, 'prospecting');

-- Contato comum (via WhatsApp, com telefone) e contato protegido
select public.ingest_whatsapp_text_message('ex_instance', 'ex-c1', '5582988885500@s.whatsapp.net', false, 'Cliente Exportável', 'Oi', now());
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b5500006-0000-4000-8000-000000000002', 'b5500002-0000-4000-8000-000000000001', 'EX Protegido', 'lead', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');
insert into public.contact_points (id, workspace_id, contact_id, point_type, normalized_value, display_value, operational_status, is_protected, protected_at, commercial_visible_from, created_at, updated_at)
values ('b5500007-0000-4000-8000-000000000002', 'b5500002-0000-4000-8000-000000000001', 'b5500006-0000-4000-8000-000000000002', 'phone', '+5582977005500', '(82) 97700-5500', 'active', true, now() - interval '1 hour', null, now() - interval '2 hours', now() - interval '2 hours');

-- Contato de outro workspace (nunca pode aparecer na exportação deste)
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, commercial_visible_from, created_at, updated_at)
values ('b5500006-0000-4000-8000-000000000009', 'b5500002-0000-4000-8000-000000000009', 'EX Contato Alheio', 'lead', 'active', false, now(), now(), now());

-- Oportunidade com responsável, valores financeiros e descrição privada
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, responsible_member_id, title, status, origin, operation_type, city_region_preference,
                                   value_range_preference, family_income, approved_amount, financial_notes, description)
select 'b5500008-0000-4000-8000-000000000001', c.workspace_id, c.id, 'b5500005-0000-4000-8000-000000000001', 'b5500003-0000-4000-8000-000000000002',
       'Apartamento Jatiúca', 'open', 'Instagram', 'financiamento', 'Maceió', 'R$ 300 mil', 98765.43, 250000, 'nota financeira secreta', 'descrição privada'
from public.contacts c where c.display_name = 'Cliente Exportável';

-- ─── Permissões ──────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.export_dataset(text)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.export_dataset(text)', 'execute')
    and not pg_catalog.has_function_privilege('service_role', 'public.export_dataset(text)', 'execute'),
    'export_dataset é executável só por authenticated'
);

-- ─── ATTENDANT: negado e auditado ──────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000002';

select is((select public.export_dataset('contacts')->>'success'), 'false', 'ATTENDANT não exporta contatos');
select ok(not (public.export_dataset('contacts') ? 'rows'), 'e a resposta negada não traz nenhuma linha');
select is((select public.export_dataset('opportunities')->>'success'), 'false', 'ATTENDANT não exporta oportunidades');

reset role;
select results_eq(
    $$select action, result, actor_member_id::text from public.audit_events where action like 'export.%' and result = 'denied' order by action, occurred_at limit 2$$,
    $$values ('export.contacts'::text, 'denied'::text, 'b5500003-0000-4000-8000-000000000002'::text),
             ('export.contacts'::text, 'denied'::text, 'b5500003-0000-4000-8000-000000000002'::text)$$,
    'a tentativa negada fica registrada, com o ATTENDANT como autor'
);
select is(
    (select count(*) from public.audit_events where action = 'export.opportunities' and result = 'denied'),
    1::bigint,
    'tentativa negada de exportar oportunidades também é auditada'
);

-- ─── OWNER: contatos ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000001';

select set_config('ex.contacts', public.export_dataset('contacts')::text, true);

select is((current_setting('ex.contacts')::jsonb->>'success'), 'true', 'OWNER exporta contatos');
select is(
    jsonb_array_length(current_setting('ex.contacts')::jsonb->'rows'),
    2,
    'exporta os contatos do próprio workspace (o do outro workspace fica de fora)'
);
select ok(
    not exists (select 1 from jsonb_array_elements(current_setting('ex.contacts')::jsonb->'rows') r where r->>'display_name' = 'EX Contato Alheio'),
    'nenhum contato de outro workspace vaza'
);
select is(
    (select (r->>'is_protected')::boolean from jsonb_array_elements(current_setting('ex.contacts')::jsonb->'rows') r where r->>'display_name' = 'EX Protegido'),
    true,
    'contato protegido entra na exportação do OWNER, marcado como protegido'
);
select ok(
    (select r->>'phones' from jsonb_array_elements(current_setting('ex.contacts')::jsonb->'rows') r where r->>'display_name' = 'EX Protegido') like '%97700-5500%',
    'os telefones do contato vêm na linha'
);
select is((current_setting('ex.contacts')::jsonb->>'truncated'), 'false', 'sem truncamento em volume pequeno');

-- ─── OWNER: oportunidades ────────────────────────────────────────────────────────────────────────
select set_config('ex.opps', public.export_dataset('opportunities')::text, true);
select is(jsonb_array_length(current_setting('ex.opps')::jsonb->'rows'), 1, 'exporta as oportunidades do workspace');
select results_eq(
    $$select r->>'title', r->>'contact_name', r->>'stage_name', r->>'responsible_name', r->>'status'
      from jsonb_array_elements(current_setting('ex.opps')::jsonb->'rows') r$$,
    $$values ('Apartamento Jatiúca'::text, 'Cliente Exportável'::text, 'EX Etapa Visita'::text, 'EX Atendente A'::text, 'open'::text)$$,
    'a linha traz título, contato, etapa, responsável e situação (nomes, não ids)'
);
select ok(
    not exists (
        select 1 from jsonb_array_elements(current_setting('ex.opps')::jsonb->'rows') r, jsonb_object_keys(r) k
        where k in ('family_income', 'approved_amount', 'financial_notes', 'description', 'workspace_id')
    ),
    'dados financeiros sensíveis e descrição privada não fazem parte da exportação'
);
select ok(
    current_setting('ex.opps') not like '%nota financeira secreta%' and current_setting('ex.opps') not like '%98765%',
    'nenhum valor financeiro privado aparece no conteúdo'
);

-- ─── Auditoria da exportação ───────────────────────────────────────────────────────────────────
reset role;
select results_eq(
    $$select action, result, actor_member_id::text, (metadata->>'row_count')::int from public.audit_events where action = 'export.contacts' and result = 'success'$$,
    $$values ('export.contacts'::text, 'success'::text, 'b5500003-0000-4000-8000-000000000001'::text, 2)$$,
    'a exportação de contatos é auditada com a contagem de linhas'
);
select results_eq(
    $$select (metadata->>'row_count')::int from public.audit_events where action = 'export.opportunities' and result = 'success'$$,
    $$values (1)$$,
    'a exportação de oportunidades é auditada com a contagem'
);
select ok(
    not exists (
        select 1 from public.audit_events
        where action like 'export.%' and (metadata::text ilike '%Exportável%' or metadata::text ilike '%97700%' or metadata::text ilike '%Jatiúca%')
    ),
    'a auditoria da exportação não guarda nomes, telefones nem títulos'
);

-- ─── Isolamento e validação ───────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000009';
select is(
    (select jsonb_array_length(public.export_dataset('contacts')->'rows')),
    1,
    'OWNER de outro workspace só exporta o que é dele'
);
select is(
    (select jsonb_array_length(public.export_dataset('opportunities')->'rows')),
    0,
    'e nenhuma oportunidade alheia'
);
select throws_ok($$select public.export_dataset('mensagens')$$, '22023', 'invalid_export_kind', 'tipo desconhecido é recusado');
select throws_ok($$select public.export_dataset(null)$$, '22023', 'invalid_export_kind', 'tipo nulo é recusado');

-- Sem sessão válida
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-0000000000ff';
select throws_ok($$select public.export_dataset('contacts')$$, '42501', 'resource_not_available', 'usuário sem vínculo ativo não exporta');

-- Arquivados também entram (nada é excluído; a coluna de arquivamento informa)
reset role;
update public.contacts set operational_status = 'inactive', inactive_at = now(), archived_at = now() where id = 'b5500006-0000-4000-8000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000001';
select is(
    (select (r->>'archived_at') is not null from jsonb_array_elements(public.export_dataset('contacts')->'rows') r where r->>'display_name' = 'EX Protegido'),
    true,
    'contato arquivado continua na exportação, com a data de arquivamento'
);
select is(
    (select jsonb_array_length(public.export_dataset('contacts')->'rows')),
    2,
    'arquivar não remove da exportação'
);

reset role;
select is(
    (select count(*) from public.contacts where workspace_id = 'b5500002-0000-4000-8000-000000000001'),
    2::bigint,
    'exportar não altera nem apaga dados'
);

select * from finish();
rollback;
