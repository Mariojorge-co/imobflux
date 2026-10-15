begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(9);

insert into auth.users (id, email)
values
    ('b5300000-0000-4000-8000-000000000001', 'ac-owner@example.test'),
    ('b5300000-0000-4000-8000-000000000002', 'ac-att@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5300001-0000-4000-8000-000000000001', 'b5300000-0000-4000-8000-000000000001', 'AC Owner', 'active'),
    ('b5300001-0000-4000-8000-000000000002', 'b5300000-0000-4000-8000-000000000002', 'AC Att', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5300002-0000-4000-8000-000000000001', 'AC Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5300003-0000-4000-8000-000000000001', 'b5300002-0000-4000-8000-000000000001', 'b5300001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5300003-0000-4000-8000-000000000002', 'b5300002-0000-4000-8000-000000000001', 'b5300001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5300003-0000-4000-8000-000000000001');

insert into public.audit_events (workspace_id, actor_type, actor_member_id, action, target_type, target_id, result, metadata, occurred_at, recorded_at)
values
    ('b5300002-0000-4000-8000-000000000001', 'member', 'b5300003-0000-4000-8000-000000000001', 'quick_reply.created', 'quick_reply', gen_random_uuid(), 'success', '{}', now(), now()),
    ('b5300002-0000-4000-8000-000000000001', 'member', 'b5300003-0000-4000-8000-000000000001', 'sla.conversation_paused', 'conversation', gen_random_uuid(), 'success', '{}', now(), now()),
    ('b5300002-0000-4000-8000-000000000001', 'member', 'b5300003-0000-4000-8000-000000000001', 'message.file_sent', 'message', gen_random_uuid(), 'success', '{}', now(), now()),
    ('b5300002-0000-4000-8000-000000000001', 'member', 'b5300003-0000-4000-8000-000000000001', 'group.team_visibility_enabled', 'conversation', gen_random_uuid(), 'success', '{}', now(), now());

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5300000-0000-4000-8000-000000000001';

select lives_ok($$select public.get_audit_events('quick_reply')$$, 'categoria quick_reply é aceita');
select lives_ok($$select public.get_audit_events('sla')$$, 'categoria sla é aceita');
select lives_ok($$select public.get_audit_events('message')$$, 'categoria message é aceita');
select is(jsonb_array_length(public.get_audit_events('sla')->'events'), 1, 'filtro sla devolve só eventos sla.*');
select is(jsonb_array_length(public.get_audit_events('message')->'events'), 1, 'filtro message devolve só eventos message.*');
select is(jsonb_array_length(public.get_audit_events('quick_reply')->'events'), 1, 'filtro quick_reply devolve só eventos quick_reply.*');
select lives_ok($$select public.get_audit_events('group')$$, 'categorias antigas continuam aceitas');
select throws_ok($$select public.get_audit_events('inexistente')$$, '22023', 'audit_invalid_filter', 'categoria desconhecida continua recusada');

set local "request.jwt.claim.sub" = 'b5300000-0000-4000-8000-000000000002';
select throws_ok($$select public.get_audit_events('sla')$$, '42501', 'audit_not_authorized', 'atendente continua sem acesso à auditoria');

select * from finish();
rollback;
