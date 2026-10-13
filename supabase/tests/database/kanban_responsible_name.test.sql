begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(5);

insert into auth.users (id, email)
values
    ('b5600000-0000-4000-8000-000000000001', 'kr-owner@example.test'),
    ('b5600000-0000-4000-8000-000000000002', 'kr-a@example.test'),
    ('b5600000-0000-4000-8000-000000000009', 'kr-other@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5600001-0000-4000-8000-000000000001', 'b5600000-0000-4000-8000-000000000001', 'KR Dono', 'active'),
    ('b5600001-0000-4000-8000-000000000002', 'b5600000-0000-4000-8000-000000000002', 'KR Atendente', 'active'),
    ('b5600001-0000-4000-8000-000000000009', 'b5600000-0000-4000-8000-000000000009', 'KR Outro', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5600002-0000-4000-8000-000000000001', 'KR Workspace', 'active', 'America/Maceio'),
       ('b5600002-0000-4000-8000-000000000009', 'KR Outro Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5600003-0000-4000-8000-000000000001', 'b5600002-0000-4000-8000-000000000001', 'b5600001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5600003-0000-4000-8000-000000000002', 'b5600002-0000-4000-8000-000000000001', 'b5600001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5600003-0000-4000-8000-000000000001'),
    ('b5600003-0000-4000-8000-000000000009', 'b5600002-0000-4000-8000-000000000009', 'b5600001-0000-4000-8000-000000000009', 'owner', 'active', now(), null);
insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values ('b5600005-0000-4000-8000-000000000001', 'b5600002-0000-4000-8000-000000000001', 'KR Etapa', 1, true, 'prospecting');
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, commercial_visible_from, created_at, updated_at)
values ('b5600006-0000-4000-8000-000000000001', 'b5600002-0000-4000-8000-000000000001', 'KR Cliente', 'lead', 'active', false, now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours');
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, responsible_member_id, title, status)
values ('b5600007-0000-4000-8000-000000000001', 'b5600002-0000-4000-8000-000000000001', 'b5600006-0000-4000-8000-000000000001', 'b5600005-0000-4000-8000-000000000001', 'b5600003-0000-4000-8000-000000000001', 'KR Opp do Dono', 'open'),
       ('b5600007-0000-4000-8000-000000000002', 'b5600002-0000-4000-8000-000000000001', 'b5600006-0000-4000-8000-000000000001', 'b5600005-0000-4000-8000-000000000001', null, 'KR Opp sem dono', 'open');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5600000-0000-4000-8000-000000000002';

select is(
    (select c->>'responsible_name' from jsonb_array_elements(public.get_kanban_board(50)) s, jsonb_array_elements(s->'cards') c where c->>'title' = 'KR Opp do Dono'),
    'KR Dono',
    'o ATTENDANT vê o nome do responsável colega no card do Kanban'
);
select is(
    (select c->>'responsible_member_id' from jsonb_array_elements(public.get_kanban_board(50)) s, jsonb_array_elements(s->'cards') c where c->>'title' = 'KR Opp do Dono'),
    'b5600003-0000-4000-8000-000000000001',
    'o id do responsável continua no card'
);
select is(
    (select (c->'responsible_name') = 'null'::jsonb from jsonb_array_elements(public.get_kanban_board(50)) s, jsonb_array_elements(s->'cards') c where c->>'title' = 'KR Opp sem dono'),
    true,
    'oportunidade sem responsável continua sem nome'
);

set local "request.jwt.claim.sub" = 'b5600000-0000-4000-8000-000000000001';
select is(
    (select c->>'responsible_name' from jsonb_array_elements(public.get_kanban_board(50)) s, jsonb_array_elements(s->'cards') c where c->>'title' = 'KR Opp do Dono'),
    'KR Dono',
    'o OWNER continua vendo o nome'
);

set local "request.jwt.claim.sub" = 'b5600000-0000-4000-8000-000000000009';
select is(
    (select count(*) from jsonb_array_elements(public.get_kanban_board(50)) s, jsonb_array_elements(s->'cards') c),
    0::bigint,
    'outro workspace não vê oportunidades nem nomes alheios'
);

select * from finish();
rollback;
