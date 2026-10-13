begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(28);

-- ─── Fixtures ──────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email)
values
    ('b5300000-0000-4000-8000-000000000001', 'au-owner@example.test'),
    ('b5300000-0000-4000-8000-000000000002', 'au-a@example.test'),
    ('b5300000-0000-4000-8000-000000000009', 'au-other-owner@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5300001-0000-4000-8000-000000000001', 'b5300000-0000-4000-8000-000000000001', 'AU Owner', 'active'),
    ('b5300001-0000-4000-8000-000000000002', 'b5300000-0000-4000-8000-000000000002', 'AU Atendente A', 'active'),
    ('b5300001-0000-4000-8000-000000000009', 'b5300000-0000-4000-8000-000000000009', 'AU Outro Owner', 'active');

insert into public.workspaces (id, name, status, timezone)
values
    ('b5300002-0000-4000-8000-000000000001', 'AU Workspace', 'active', 'America/Maceio'),
    ('b5300002-0000-4000-8000-000000000009', 'AU Outro Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5300003-0000-4000-8000-000000000001', 'b5300002-0000-4000-8000-000000000001', 'b5300001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5300003-0000-4000-8000-000000000002', 'b5300002-0000-4000-8000-000000000001', 'b5300001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5300003-0000-4000-8000-000000000001'),
    ('b5300003-0000-4000-8000-000000000009', 'b5300002-0000-4000-8000-000000000009', 'b5300001-0000-4000-8000-000000000009', 'owner', 'active', now(), null);

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5300004-0000-4000-8000-000000000001', 'b5300002-0000-4000-8000-000000000001', 'whatsapp', 'au_instance', '+5582999905300', 'active', now());

insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values
    ('b5300005-0000-4000-8000-000000000001', 'b5300002-0000-4000-8000-000000000001', 'AU Etapa 1', 1, true, 'prospecting'),
    ('b5300005-0000-4000-8000-000000000002', 'b5300002-0000-4000-8000-000000000001', 'AU Etapa 2', 2, true, 'qualification');

select public.ingest_whatsapp_text_message('au_instance', 'au-c1', '5582988885300@s.whatsapp.net', false, 'Cliente AU', 'Oi, quero comprar', now());

create temp table au_ids (k text primary key, id uuid);
grant all on au_ids to public;
insert into au_ids select 'conv', id from public.conversations where external_thread_id = '5582988885300@s.whatsapp.net';
insert into au_ids select 'contact', c.id from public.contacts c where c.display_name = 'Cliente AU';

-- ─── Permissões e leitura ──────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.get_audit_events(text,uuid,timestamptz,timestamptz,timestamptz,uuid,integer)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.get_audit_events(text,uuid,timestamptz,timestamptz,timestamptz,uuid,integer)', 'execute'),
    'get_audit_events é para authenticated e nunca para anon'
);

-- ─── Ações sensíveis geram eventos ───────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5300000-0000-4000-8000-000000000001';

select set_config('au.opp', public.create_opportunity(
    (select id from au_ids where k = 'contact'),
    'b5300005-0000-4000-8000-000000000001'::uuid,
    'AU Oportunidade', 'descrição privada do cliente', 'b5300003-0000-4000-8000-000000000001'::uuid
)::text, true);

select is(
    (select public.link_opportunity_conversation(current_setting('au.opp')::uuid, (select id from au_ids where k = 'conv'))->>'status'),
    'success',
    'vincular conversa à oportunidade funciona'
);
select is(
    (select public.assign_conversation((select id from au_ids where k = 'conv'), 'b5300003-0000-4000-8000-000000000002')->>'status'),
    'assigned',
    'atribuir conversa funciona'
);
select is(
    (select public.move_opportunity_stage(current_setting('au.opp')::uuid, 'b5300005-0000-4000-8000-000000000001'::uuid, 'b5300005-0000-4000-8000-000000000002'::uuid)->>'status'),
    'success',
    'mudar a oportunidade de etapa funciona'
);

set local "request.jwt.claim.sub" = 'b5300000-0000-4000-8000-000000000002';
select is(
    (select public.update_contact_opportunity_qualification(
        (select id from au_ids where k = 'contact'), current_setting('au.opp')::uuid,
        p_operation_type => 'compra', p_notes => 'Prefere andar alto, segredo de negociação')->>'success'),
    'true',
    'ATTENDANT atualiza a qualificação'
);

reset role;
select is(
    (select count(*) from public.audit_events where action = 'opportunity.conversation_linked' and target_id = current_setting('au.opp')::uuid),
    1::bigint,
    'vincular conversa é auditado (alvo: oportunidade)'
);
select is(
    (select metadata->>'conversation_id' from public.audit_events where action = 'opportunity.conversation_linked'),
    (select id::text from au_ids where k = 'conv'),
    'a auditoria do vínculo guarda só o id da conversa'
);
select is(
    (select count(*) from public.audit_events where action = 'opportunity.qualification_updated' and actor_member_id = 'b5300003-0000-4000-8000-000000000002'),
    1::bigint,
    'atualizar a qualificação é auditado, com o ATTENDANT como autor'
);
select ok(
    (select metadata->'fields' @> '["operation_type","notes"]'::jsonb from public.audit_events where action = 'opportunity.qualification_updated'),
    'a auditoria da qualificação lista os campos alterados'
);
select ok(
    not exists (
        select 1 from public.audit_events
        where metadata::text ilike '%segredo de negociação%' or metadata::text ilike '%descrição privada%' or metadata::text ilike '%compra%'
    ),
    'nenhum evento copia o conteúdo digitado (notas, descrições, valores)'
);

-- ─── Imutabilidade ─────────────────────────────────────────────────────────────────────────────
select throws_ok(
    $$update public.audit_events set result = 'failed' where action = 'conversation.assigned'$$,
    null, null,
    'evento de auditoria não pode ser alterado'
);
select throws_ok(
    $$delete from public.audit_events where action = 'conversation.assigned'$$,
    null, null,
    'evento de auditoria não pode ser apagado'
);

-- ─── Consulta (OWNER) ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5300000-0000-4000-8000-000000000002';
select throws_ok(
    $$select public.get_audit_events()$$,
    '42501', 'audit_not_authorized',
    'ATTENDANT não consulta a auditoria'
);
select is(
    (select count(*) from public.audit_events),
    0::bigint,
    'ATTENDANT também não lê a tabela diretamente (RLS)'
);

set local "request.jwt.claim.sub" = 'b5300000-0000-4000-8000-000000000001';
select ok(
    (select jsonb_array_length(public.get_audit_events()->'events')) >= 5,
    'OWNER vê os eventos do workspace'
);
select is(
    (select public.get_audit_events()->'events'->0->>'action'),
    (select action from public.audit_events order by occurred_at desc, id desc limit 1),
    'ordenados do mais recente para o mais antigo'
);
select is(
    (select e->>'actor_name' from jsonb_array_elements(public.get_audit_events('conversation')->'events') e where e->>'action' = 'conversation.assigned'),
    'AU Owner',
    'cada evento traz o nome de quem fez'
);
select is(
    (select count(*) from jsonb_array_elements(public.get_audit_events('conversation')->'events') e where e->>'action' not like 'conversation.%'),
    0::bigint,
    'filtro por categoria devolve só a categoria'
);
select is(
    (select count(*) from jsonb_array_elements(public.get_audit_events('opportunity')->'events') e where e->>'action' like 'opportunity.%'),
    (select count(*) from public.audit_events where action like 'opportunity.%'),
    'categoria "opportunity" traz tudo dela (criação, vínculo, etapa, qualificação)'
);
select is(
    (select count(*) from jsonb_array_elements(public.get_audit_events(null, 'b5300003-0000-4000-8000-000000000002')->'events') e where e->>'actor_member_id' <> 'b5300003-0000-4000-8000-000000000002'),
    0::bigint,
    'filtro por pessoa devolve só as ações dela'
);
select is(
    (select jsonb_array_length(public.get_audit_events(null, null, now() + interval '1 day')->'events')),
    0,
    'filtro de período (a partir de amanhã) não devolve nada'
);
select ok(
    (select jsonb_array_length(public.get_audit_events(null, null, null, now() + interval '1 day')->'events')) >= 5,
    'filtro de período até amanhã devolve tudo'
);
select throws_ok(
    $$select public.get_audit_events('inventada')$$,
    '22023', 'audit_invalid_filter',
    'categoria desconhecida é recusada'
);

-- Paginação por cursor
select set_config('au.page1', public.get_audit_events(null, null, null, null, null, null, 2)::text, true);
select is(jsonb_array_length(current_setting('au.page1')::jsonb->'events'), 2, 'a página respeita o limite');
select is((current_setting('au.page1')::jsonb->>'has_more')::boolean, true, 'avisa que há mais eventos');
select is(
    (select jsonb_array_length(public.get_audit_events(
        null, null, null, null,
        (current_setting('au.page1')::jsonb->'events'->1->>'occurred_at')::timestamptz,
        (current_setting('au.page1')::jsonb->'events'->1->>'id')::uuid,
        200)->'events')),
    (select count(*)::int - 2 from public.audit_events),
    'a segunda página continua de onde a primeira parou, sem repetir nem pular'
);

-- Isolamento entre workspaces
set local "request.jwt.claim.sub" = 'b5300000-0000-4000-8000-000000000009';
select is(
    (select jsonb_array_length(public.get_audit_events()->'events')),
    0,
    'OWNER de outro workspace não vê eventos alheios'
);

reset role;
select is(
    (select count(*) from public.audit_events where action = 'conversation.assigned'),
    1::bigint,
    'consultar a auditoria não cria eventos (simples visualização não audita)'
);

select * from finish();
rollback;
