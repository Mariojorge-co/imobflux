begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(11);

-- B5: get_audit_events devolve os nomes de todos os membros citados nos eventos (autor e ids do metadata),
-- inclusive removidos, e nunca de outro workspace.
insert into auth.users (id, email)
values
    ('b5a00000-0000-4000-8000-000000000001', 'an-owner@example.test'),
    ('b5a00000-0000-4000-8000-000000000002', 'an-a@example.test'),
    ('b5a00000-0000-4000-8000-000000000003', 'an-b@example.test'),
    ('b5a00000-0000-4000-8000-000000000009', 'an-other@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5a00001-0000-4000-8000-000000000001', 'b5a00000-0000-4000-8000-000000000001', 'AN Dono', 'active'),
    ('b5a00001-0000-4000-8000-000000000002', 'b5a00000-0000-4000-8000-000000000002', 'AN Ana', 'active'),
    ('b5a00001-0000-4000-8000-000000000003', 'b5a00000-0000-4000-8000-000000000003', 'AN Bruno', 'active'),
    ('b5a00001-0000-4000-8000-000000000009', 'b5a00000-0000-4000-8000-000000000009', 'AN Alheio', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5a00002-0000-4000-8000-000000000001', 'AN Workspace', 'active', 'America/Maceio'),
       ('b5a00002-0000-4000-8000-000000000009', 'AN Outro Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5a00003-0000-4000-8000-000000000001', 'b5a00002-0000-4000-8000-000000000001', 'b5a00001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5a00003-0000-4000-8000-000000000002', 'b5a00002-0000-4000-8000-000000000001', 'b5a00001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5a00003-0000-4000-8000-000000000001'),
    ('b5a00003-0000-4000-8000-000000000003', 'b5a00002-0000-4000-8000-000000000001', 'b5a00001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b5a00003-0000-4000-8000-000000000001'),
    ('b5a00003-0000-4000-8000-000000000009', 'b5a00002-0000-4000-8000-000000000009', 'b5a00001-0000-4000-8000-000000000009', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5a00004-0000-4000-8000-000000000001', 'b5a00002-0000-4000-8000-000000000001', 'whatsapp', 'an_instance', '+5582999905900', 'active', now());
select public.ingest_whatsapp_text_message('an_instance', 'an-c1', '5582988885900@s.whatsapp.net', false, 'Cliente AN', 'Oi', now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5a00000-0000-4000-8000-000000000001';
select public.assign_conversation((select id from public.conversations limit 1), 'b5a00003-0000-4000-8000-000000000002');
select public.reassign_conversation((select id from public.conversations limit 1), 'b5a00003-0000-4000-8000-000000000002', 'b5a00003-0000-4000-8000-000000000003');
select public.remove_team_member('b5a00003-0000-4000-8000-000000000002');

reset role;
-- Evento forjado apontando para um membro de OUTRO workspace (não pode ser resolvido)
insert into public.audit_events (workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at)
values ('b5a00002-0000-4000-8000-000000000001', 'member', 'b5a00003-0000-4000-8000-000000000001', 'conversation.assigned', 'conversation',
        (select id from public.conversations limit 1), 'success', jsonb_build_object('member_id', 'b5a00003-0000-4000-8000-000000000009'), now(), now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5a00000-0000-4000-8000-000000000001';
select set_config('an.result', public.get_audit_events()::text, true);

select ok(current_setting('an.result')::jsonb ? 'member_names', 'a resposta traz o mapa de nomes de membros');
select is(current_setting('an.result')::jsonb->'member_names'->>'b5a00003-0000-4000-8000-000000000002', 'AN Ana', 'o membro REMOVIDO tem o nome resolvido');
select is(current_setting('an.result')::jsonb->'member_names'->>'b5a00003-0000-4000-8000-000000000003', 'AN Bruno', 'membro ativo citado no metadata tem o nome');
select is(current_setting('an.result')::jsonb->'member_names'->>'b5a00003-0000-4000-8000-000000000001', 'AN Dono', 'o autor (dono) também');
select is(
    (select count(*)
     from jsonb_array_elements(current_setting('an.result')::jsonb->'events') e,
          unnest(array['member_id', 'from_member_id', 'to_member_id', 'previous_member_id', 'responsible_member_id']) k
     where e->'metadata' ? k
       and e->'metadata'->>k <> 'b5a00003-0000-4000-8000-000000000009'
       and not (current_setting('an.result')::jsonb->'member_names' ? (e->'metadata'->>k))),
    0::bigint,
    'todo id de membro do metadata (do próprio workspace) tem nome no mapa'
);
select ok(
    not (current_setting('an.result')::jsonb->'member_names' ? 'b5a00003-0000-4000-8000-000000000009'),
    'membro de outro workspace nunca é resolvido (mesmo citado num evento)'
);
select ok(
    not exists (select 1 from jsonb_each_text(current_setting('an.result')::jsonb->'member_names') n where n.value is null),
    'o mapa não tem nomes nulos'
);
select is(
    (select e->>'actor_name' from jsonb_array_elements(current_setting('an.result')::jsonb->'events') e where e->>'action' = 'team.member_removed'),
    'AN Dono',
    'o nome do autor continua em cada evento'
);
select ok(
    (current_setting('an.result')::jsonb->'member_names') = (current_setting('an.result')::jsonb->'member_names') and (current_setting('an.result')::jsonb->>'has_more') = 'false',
    'a paginação continua funcionando (has_more)'
);

set local "request.jwt.claim.sub" = 'b5a00000-0000-4000-8000-000000000003';
select throws_ok($$select public.get_audit_events()$$, '42501', 'audit_not_authorized', 'ATTENDANT continua sem acesso à auditoria');
set local "request.jwt.claim.sub" = 'b5a00000-0000-4000-8000-000000000009';
select is(
    (select jsonb_array_length(public.get_audit_events()->'events')) || '/' || (select count(*) from jsonb_object_keys(public.get_audit_events()->'member_names')),
    '0/0',
    'OWNER de outro workspace não vê eventos nem nomes alheios'
);

select * from finish();
rollback;
