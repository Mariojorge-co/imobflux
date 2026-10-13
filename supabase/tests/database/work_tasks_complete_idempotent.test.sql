begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(8);

-- B3: concluir uma tarefa já concluída é idempotente (duplo clique, dois membros ao mesmo tempo).
insert into auth.users (id, email)
values
    ('b5900000-0000-4000-8000-000000000001', 'tf-owner@example.test'),
    ('b5900000-0000-4000-8000-000000000002', 'tf-a@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5900001-0000-4000-8000-000000000001', 'b5900000-0000-4000-8000-000000000001', 'TF Owner', 'active'),
    ('b5900001-0000-4000-8000-000000000002', 'b5900000-0000-4000-8000-000000000002', 'TF A', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5900002-0000-4000-8000-000000000001', 'TF Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5900003-0000-4000-8000-000000000001', 'b5900002-0000-4000-8000-000000000001', 'b5900001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5900003-0000-4000-8000-000000000002', 'b5900002-0000-4000-8000-000000000001', 'b5900001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5900003-0000-4000-8000-000000000001');
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected, commercial_visible_from, created_at, updated_at)
values ('b5900006-0000-4000-8000-000000000001', 'b5900002-0000-4000-8000-000000000001', 'TF Cliente', 'lead', 'active', false, now() - interval '1 hour', now() - interval '2 hours', now() - interval '2 hours');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5900000-0000-4000-8000-000000000001';

select set_config('tf.done', public.create_work_task('Para concluir', 'task', null, 'normal', null, null, null, 'b5900006-0000-4000-8000-000000000001', null, null)->>'task_id', true);
select set_config('tf.cancelled', public.create_work_task('Para cancelar', 'task', null, 'normal', null, null, null, 'b5900006-0000-4000-8000-000000000001', null, null)->>'task_id', true);

select is((select public.complete_work_task(current_setting('tf.done')::uuid)->>'status'), 'completed', 'primeira conclusão responde "completed"');

set local "request.jwt.claim.sub" = 'b5900000-0000-4000-8000-000000000002';
select is((select public.complete_work_task(current_setting('tf.done')::uuid)->>'success'), 'true', 'concluir de novo (outro membro) é tratado como sucesso');
select is((select public.complete_work_task(current_setting('tf.done')::uuid)->>'status'), 'already_completed', 'e avisa que já estava concluída');

reset role;
select results_eq(
    $$select completed_by_member_id::text, status from public.work_tasks where id = current_setting('tf.done')::uuid$$,
    $$values ('b5900003-0000-4000-8000-000000000001'::text, 'completed'::text)$$,
    'a repetição não troca quem concluiu nem altera a tarefa'
);
select is(
    (select count(*) from public.audit_events where action = 'task.completed' and target_id = current_setting('tf.done')::uuid),
    1::bigint,
    'a repetição não gera um segundo evento de auditoria'
);

-- Tarefa cancelada continua não podendo ser concluída
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5900000-0000-4000-8000-000000000001';
select is((select public.cancel_work_task(current_setting('tf.cancelled')::uuid)->>'success'), 'true', 'cancelar tarefa pendente');
select throws_ok(
    $$select public.complete_work_task(current_setting('tf.cancelled')::uuid)$$,
    '55000', 'task_not_pending',
    'concluir uma tarefa cancelada continua recusado (não é repetição)'
);
select throws_ok(
    $$select public.cancel_work_task(current_setting('tf.done')::uuid)$$,
    '55000', 'task_not_pending',
    'cancelar uma tarefa concluída continua recusado'
);

select * from finish();
rollback;
