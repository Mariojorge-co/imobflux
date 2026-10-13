begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists pgrowlocks with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(16);

-- Fecha a corrida entre "remover funcionário" e "atribuir trabalho a ele": as funções que validam o membro
-- (status ativo) devem travá-lo com FOR SHARE até o fim da transação. Assim, uma remoção concorrente
-- (que usa FOR UPDATE) espera a atribuição terminar e depois libera o que foi atribuído; e uma atribuição
-- que comece depois da remoção enxerga o membro como removido e é recusada.
-- O teste observa o travamento de linha (pgrowlocks) dentro da própria transação.

insert into auth.users (id, email)
values
    ('b5800000-0000-4000-8000-000000000001', 'rl-owner@example.test'),
    ('b5800000-0000-4000-8000-000000000002', 'rl-a@example.test'),
    ('b5800000-0000-4000-8000-000000000003', 'rl-b@example.test'),
    ('b5800000-0000-4000-8000-000000000004', 'rl-c@example.test'),
    ('b5800000-0000-4000-8000-000000000005', 'rl-d@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5800001-0000-4000-8000-000000000001', 'b5800000-0000-4000-8000-000000000001', 'RL Owner', 'active'),
    ('b5800001-0000-4000-8000-000000000002', 'b5800000-0000-4000-8000-000000000002', 'RL A', 'active'),
    ('b5800001-0000-4000-8000-000000000003', 'b5800000-0000-4000-8000-000000000003', 'RL B', 'active'),
    ('b5800001-0000-4000-8000-000000000004', 'b5800000-0000-4000-8000-000000000004', 'RL C', 'active'),
    ('b5800001-0000-4000-8000-000000000005', 'b5800000-0000-4000-8000-000000000005', 'RL D', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b5800002-0000-4000-8000-000000000001', 'RL Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5800003-0000-4000-8000-000000000001', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5800003-0000-4000-8000-000000000002', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5800003-0000-4000-8000-000000000001'),
    ('b5800003-0000-4000-8000-000000000003', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b5800003-0000-4000-8000-000000000001'),
    ('b5800003-0000-4000-8000-000000000004', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000004', 'attendant', 'active', now(), 'b5800003-0000-4000-8000-000000000001'),
    ('b5800003-0000-4000-8000-000000000005', 'b5800002-0000-4000-8000-000000000001', 'b5800001-0000-4000-8000-000000000005', 'attendant', 'active', now(), 'b5800003-0000-4000-8000-000000000001');
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5800004-0000-4000-8000-000000000001', 'b5800002-0000-4000-8000-000000000001', 'whatsapp', 'rl_instance', '+5582999905800', 'active', now());
select public.ingest_whatsapp_text_message('rl_instance', 'rl-c1', '5582988885800@s.whatsapp.net', false, 'Cliente RL', 'Oi', now());

create temp table rl_ids (k text primary key, id uuid);
grant all on rl_ids to public;
insert into rl_ids select 'conv', id from public.conversations where external_thread_id = '5582988885800@s.whatsapp.net';
insert into rl_ids select 'contact', id from public.contacts where display_name = 'Cliente RL';

-- Membros que foram travados "para compartilhar" nesta transação
create or replace function pg_temp.share_locked(p_member uuid) returns boolean
language sql as $$
    select exists (
        select 1
        from public.workspace_members as member
        join extensions.pgrowlocks('public.workspace_members') as lock on lock.locked_row = member.ctid
        where member.id = p_member and 'For Share' = any (lock.modes)
    );
$$;

select is(pg_temp.share_locked('b5800003-0000-4000-8000-000000000002'), false, 'ponto de partida: nenhum membro está travado');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';

-- assign_conversation trava o responsável (A)
select is((select public.assign_conversation((select id from rl_ids where k = 'conv'), 'b5800003-0000-4000-8000-000000000002')->>'status'), 'assigned', 'atribuir A funciona');
reset role;
select is(pg_temp.share_locked('b5800003-0000-4000-8000-000000000002'), true, 'assign_conversation trava o membro com FOR SHARE');

-- reassign_conversation trava o novo responsável (B)
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select is((select public.reassign_conversation((select id from rl_ids where k = 'conv'), 'b5800003-0000-4000-8000-000000000002', 'b5800003-0000-4000-8000-000000000003')->>'status'), 'reassigned', 'trocar A por B funciona');
reset role;
select is(pg_temp.share_locked('b5800003-0000-4000-8000-000000000003'), true, 'reassign_conversation trava o novo responsável com FOR SHARE');

-- create_work_task trava o responsável (C)
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select set_config('rl.task', public.create_work_task('Tarefa RL', 'task', null, 'normal', 'b5800003-0000-4000-8000-000000000004', null, null, (select id from rl_ids where k = 'contact'), null, null)->>'task_id', true);
reset role;
select is(pg_temp.share_locked('b5800003-0000-4000-8000-000000000004'), true, 'create_work_task trava o responsável com FOR SHARE');

-- reassign_work_task trava o novo responsável (D)
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select is((select public.reassign_work_task(current_setting('rl.task')::uuid, 'b5800003-0000-4000-8000-000000000005')->>'status'), 'reassigned', 'reatribuir a tarefa para D funciona');
reset role;
select is(pg_temp.share_locked('b5800003-0000-4000-8000-000000000005'), true, 'reassign_work_task trava o novo responsável com FOR SHARE');

-- ─── Ordem das operações ─────────────────────────────────────────────────────────────────────────
-- (a) atribuir e DEPOIS remover: a atribuição é encerrada, nada fica ativo para o removido
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select is((select public.remove_team_member('b5800003-0000-4000-8000-000000000003')->>'status'), 'removed', 'remover B (que acabou de receber a conversa)');
reset role;
select is(
    (select count(*) from public.conversation_assignments where member_id = 'b5800003-0000-4000-8000-000000000003' and ended_at is null),
    0::bigint,
    'atribuir e depois remover: nenhuma atribuição ativa sobra para o removido'
);

-- (b) remover e DEPOIS atribuir: recusado
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5800000-0000-4000-8000-000000000001';
select throws_ok(
    $$select public.assign_conversation((select id from rl_ids where k = 'conv'), 'b5800003-0000-4000-8000-000000000003')$$,
    '22023', 'assignee_not_active',
    'remover e depois atribuir: recusado'
);
select throws_ok(
    $$select public.reassign_conversation((select id from rl_ids where k = 'conv'), 'b5800003-0000-4000-8000-000000000001', 'b5800003-0000-4000-8000-000000000003')$$,
    '22023', 'assignee_not_active',
    'remover e depois trocar para ele: recusado'
);
select throws_ok(
    $$select public.create_work_task('Para removido', 'task', null, 'normal', 'b5800003-0000-4000-8000-000000000003', null, null, (select id from rl_ids where k = 'contact'), null, null)$$,
    '22023', 'assignee_not_active',
    'remover e depois criar tarefa para ele: recusado'
);
select throws_ok(
    $$select public.reassign_work_task(current_setting('rl.task')::uuid, 'b5800003-0000-4000-8000-000000000003')$$,
    '22023', 'assignee_not_active',
    'remover e depois reatribuir tarefa para ele: recusado'
);

-- (c) tarefa com responsável D, depois D removido: responsável vira nulo e a tarefa continua pendente
select is((select public.remove_team_member('b5800003-0000-4000-8000-000000000005')->>'status'), 'removed', 'remover D (responsável da tarefa)');
reset role;
select results_eq(
    $$select status, responsible_member_id::text from public.work_tasks where id = current_setting('rl.task')::uuid$$,
    $$values ('pending'::text, null::text)$$,
    'tarefa criada/reatribuída e depois liberada pela remoção: continua pendente e sem responsável'
);

select * from finish();
rollback;
