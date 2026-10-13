begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(7);

-- B4: upsert_work_task (caminho de edição) só edita tarefa pendente, como update_work_task.
insert into auth.users (id, email)
values ('b5b00000-0000-4000-8000-000000000001', 'up-owner@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values ('b5b00001-0000-4000-8000-000000000001', 'b5b00000-0000-4000-8000-000000000001', 'UP Owner', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5b00002-0000-4000-8000-000000000001', 'UP Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values ('b5b00003-0000-4000-8000-000000000001', 'b5b00002-0000-4000-8000-000000000001', 'b5b00001-0000-4000-8000-000000000001', 'owner', 'active', now(), null);
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, commercial_visible_from, created_at, updated_at)
values ('b5b00006-0000-4000-8000-000000000001', 'b5b00002-0000-4000-8000-000000000001', 'UP Cliente', 'lead', 'active', false, now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5b00000-0000-4000-8000-000000000001';

select set_config('up.done', public.create_work_task('Para concluir', 'task', null, 'normal', null, null, null, 'b5b00006-0000-4000-8000-000000000001', null, null)->>'task_id', true);
select set_config('up.cancelled', public.create_work_task('Para cancelar', 'task', null, 'normal', null, null, null, 'b5b00006-0000-4000-8000-000000000001', null, null)->>'task_id', true);
select set_config('up.pending', public.create_work_task('Segue pendente', 'task', now() + interval '3 days', 'normal', null, null, null, 'b5b00006-0000-4000-8000-000000000001', null, null)->>'task_id', true);
select public.complete_work_task(current_setting('up.done')::uuid);
select public.cancel_work_task(current_setting('up.cancelled')::uuid);

select throws_ok(
    $$select public.upsert_work_task('task', 'Mudei o título', now() + interval '5 days', null, null, null, current_setting('up.done')::uuid)$$,
    '55000', 'task_not_pending',
    'upsert não edita tarefa concluída'
);
select throws_ok(
    $$select public.upsert_work_task('task', 'Mudei o título', now() + interval '5 days', null, null, null, current_setting('up.cancelled')::uuid)$$,
    '55000', 'task_not_pending',
    'upsert não edita tarefa cancelada'
);
select is(
    (select public.upsert_work_task('follow_up', 'Reagendada', now() + interval '6 days', null, null, null, current_setting('up.pending')::uuid)->>'success'),
    'true',
    'upsert continua editando tarefa pendente (mesma assinatura posicional)'
);
select is(
    (select public.upsert_work_task('task', 'Nova via upsert', now() + interval '1 day', 'b5b00006-0000-4000-8000-000000000001', null, null, null)->>'success'),
    'true',
    'upsert continua criando tarefa nova'
);

reset role;
select results_eq(
    $$select title, task_type from public.work_tasks where id = current_setting('up.pending')::uuid$$,
    $$values ('Reagendada'::text, 'follow_up'::text)$$,
    'a edição da pendente foi aplicada'
);
select results_eq(
    $$select title, status from public.work_tasks where id = current_setting('up.done')::uuid$$,
    $$values ('Para concluir'::text, 'completed'::text)$$,
    'a concluída ficou intacta'
);
select is(
    (select count(*) from public.audit_events where action = 'task.updated' and target_id = current_setting('up.pending')::uuid),
    1::bigint,
    'só a edição válida foi auditada'
);

select * from finish();
rollback;
