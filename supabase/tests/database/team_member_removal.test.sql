begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(29);

-- ─── Fixtures: OWNER, dois ATTENDANTs ativos (A e B), um convidado (C) e outro workspace ─────────
insert into auth.users (id, email)
values
    ('b5100000-0000-4000-8000-000000000001', 'rm-owner@example.test'),
    ('b5100000-0000-4000-8000-000000000002', 'rm-a@example.test'),
    ('b5100000-0000-4000-8000-000000000003', 'rm-b@example.test'),
    ('b5100000-0000-4000-8000-000000000009', 'rm-other-owner@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5100001-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000001', 'RM Owner', 'active'),
    ('b5100001-0000-4000-8000-000000000002', 'b5100000-0000-4000-8000-000000000002', 'RM Atendente A', 'active'),
    ('b5100001-0000-4000-8000-000000000003', 'b5100000-0000-4000-8000-000000000003', 'RM Atendente B', 'active'),
    ('b5100001-0000-4000-8000-000000000004', null, 'RM Convidado C', 'active'),
    ('b5100001-0000-4000-8000-000000000009', 'b5100000-0000-4000-8000-000000000009', 'RM Outro Owner', 'active');

insert into public.workspaces (id, name, status, timezone)
values
    ('b5100002-0000-4000-8000-000000000001', 'RM Workspace', 'active', 'America/Maceio'),
    ('b5100002-0000-4000-8000-000000000009', 'RM Outro Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, invited_email_normalized, role, status, activated_at, invited_at, invitation_expires_at, invited_by_member_id)
values
    ('b5100003-0000-4000-8000-000000000001', 'b5100002-0000-4000-8000-000000000001', 'b5100001-0000-4000-8000-000000000001', null, 'owner', 'active', now(), null, null, null),
    ('b5100003-0000-4000-8000-000000000002', 'b5100002-0000-4000-8000-000000000001', 'b5100001-0000-4000-8000-000000000002', null, 'attendant', 'active', now(), null, null, 'b5100003-0000-4000-8000-000000000001'),
    ('b5100003-0000-4000-8000-000000000003', 'b5100002-0000-4000-8000-000000000001', 'b5100001-0000-4000-8000-000000000003', null, 'attendant', 'active', now(), null, null, 'b5100003-0000-4000-8000-000000000001'),
    ('b5100003-0000-4000-8000-000000000004', 'b5100002-0000-4000-8000-000000000001', 'b5100001-0000-4000-8000-000000000004', 'rm-c@example.test', 'attendant', 'invited', null, now(), now() + interval '1 hour', 'b5100003-0000-4000-8000-000000000001'),
    ('b5100003-0000-4000-8000-000000000009', 'b5100002-0000-4000-8000-000000000009', 'b5100001-0000-4000-8000-000000000009', null, 'owner', 'active', now(), null, null, null);

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b5100004-0000-4000-8000-000000000001', 'b5100002-0000-4000-8000-000000000001', 'whatsapp', 'rm_instance', '+5582999905100', 'active', now());

insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values ('b5100005-0000-4000-8000-000000000001', 'b5100002-0000-4000-8000-000000000001', 'RM Etapa', 1, true, 'prospecting');

-- Conversa comercial criada por ingestão, com histórico que precisa sobreviver à remoção
select public.ingest_whatsapp_text_message('rm_instance', 'rm-msg-1', '5582988885100@s.whatsapp.net', false, 'Cliente RM', 'Quero visitar o imóvel', now());

insert into public.conversation_assignments (id, workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
select 'b5100006-0000-4000-8000-000000000001', c.workspace_id, c.id, 'b5100003-0000-4000-8000-000000000002', 'b5100003-0000-4000-8000-000000000001', now()
from public.conversations c where c.workspace_id = 'b5100002-0000-4000-8000-000000000001' limit 1;
insert into public.conversation_assignments (id, workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
select 'b5100006-0000-4000-8000-000000000002', c.workspace_id, c.id, 'b5100003-0000-4000-8000-000000000003', 'b5100003-0000-4000-8000-000000000001', now()
from public.conversations c where c.workspace_id = 'b5100002-0000-4000-8000-000000000001' limit 1;

-- Oportunidades: aberta de A, ganha de A (histórico) e aberta de B
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status, responsible_member_id)
select 'b5100007-0000-4000-8000-000000000001', c.workspace_id, c.id, 'b5100005-0000-4000-8000-000000000001', 'Opp aberta de A', 'open', 'b5100003-0000-4000-8000-000000000002'
from public.contacts c where c.workspace_id = 'b5100002-0000-4000-8000-000000000001' limit 1;
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status, responsible_member_id)
select 'b5100007-0000-4000-8000-000000000002', c.workspace_id, c.id, 'b5100005-0000-4000-8000-000000000001', 'Opp aberta de B', 'open', 'b5100003-0000-4000-8000-000000000003'
from public.contacts c where c.workspace_id = 'b5100002-0000-4000-8000-000000000001' limit 1;

-- Tarefa pendente de A, criada por A (autoria precisa ser preservada)
insert into public.work_tasks (id, workspace_id, task_type, title, status, priority, due_at, responsible_member_id, contact_id, created_by_member_id)
select 'b5100008-0000-4000-8000-000000000001', c.workspace_id, 'follow_up', 'Ligar para o cliente', 'pending', 'normal', now() + interval '1 day',
       'b5100003-0000-4000-8000-000000000002', c.id, 'b5100003-0000-4000-8000-000000000002'
from public.contacts c where c.workspace_id = 'b5100002-0000-4000-8000-000000000001' limit 1;

-- Nota interna escrita por A (autoria preservada)
insert into public.internal_notes (id, workspace_id, conversation_id, author_member_id, content)
select 'b5100009-0000-4000-8000-000000000001', c.workspace_id, c.id, 'b5100003-0000-4000-8000-000000000002', 'Nota do A'
from public.conversations c where c.workspace_id = 'b5100002-0000-4000-8000-000000000001' limit 1;

-- ─── Permissões ────────────────────────────────────────────────────────────────────────────
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.remove_team_member(uuid)', 'execute')
    and not pg_catalog.has_function_privilege('anon', 'public.remove_team_member(uuid)', 'execute'),
    'remove_team_member é executável por authenticated e não por anon'
);

-- ATTENDANT não remove ninguém
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000003';
select throws_ok(
    $$select public.remove_team_member('b5100003-0000-4000-8000-000000000002')$$,
    '42501', 'team_management_not_authorized',
    'ATTENDANT não pode remover funcionário'
);

-- ─── OWNER remove o atendente A ────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';

select throws_ok(
    $$select public.remove_team_member('b5100003-0000-4000-8000-000000000001')$$,
    '55000', 'team_member_not_removable',
    'o OWNER não pode remover a si mesmo'
);
select throws_ok(
    $$select public.remove_team_member('b5100003-0000-4000-8000-000000000009')$$,
    '55000', 'team_member_not_removable',
    'não remove membro de outro workspace'
);

select is(
    (select public.remove_team_member('b5100003-0000-4000-8000-000000000002')->>'status'),
    'removed',
    'OWNER remove o atendente A'
);

reset role;
select results_eq(
    $$select status, (removed_at is not null), role from public.workspace_members where id = 'b5100003-0000-4000-8000-000000000002'$$,
    $$values ('removed'::text, true, 'attendant'::text)$$,
    'vínculo fica "removed" com removed_at, sem ser apagado'
);

-- Acesso revogado imediatamente
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000002';
select is(
    (select count(*) from private.active_member_context()),
    0::bigint,
    'o membro removido perde o contexto ativo (sem acesso)'
);
select is(
    (select count(*) from public.conversations),
    0::bigint,
    'o membro removido não enxerga mais nenhuma conversa'
);
select throws_ok(
    $$select public.complete_work_task('b5100008-0000-4000-8000-000000000001')$$,
    '42501', null,
    'o membro removido não consegue mais agir nas tarefas'
);

-- Trabalho do removido fica livre para reatribuição
reset role;
select results_eq(
    $$select (ended_at is not null), ended_by_member_id::text, end_reason from public.conversation_assignments where id = 'b5100006-0000-4000-8000-000000000001'$$,
    $$values (true, 'b5100003-0000-4000-8000-000000000001'::text, 'member_removed'::text)$$,
    'a atribuição de conversa do removido é encerrada (motivo e autor registrados)'
);
select is(
    (select ended_at from public.conversation_assignments where id = 'b5100006-0000-4000-8000-000000000002'),
    null,
    'a atribuição do outro atendente (B) não é afetada'
);
select is(
    (select responsible_member_id from public.opportunities where id = 'b5100007-0000-4000-8000-000000000001'),
    null,
    'a oportunidade aberta do removido fica sem responsável'
);
select is(
    (select responsible_member_id::text from public.opportunities where id = 'b5100007-0000-4000-8000-000000000002'),
    'b5100003-0000-4000-8000-000000000003',
    'a oportunidade do outro atendente continua com ele'
);
select results_eq(
    $$select status, responsible_member_id::text, created_by_member_id::text from public.work_tasks where id = 'b5100008-0000-4000-8000-000000000001'$$,
    $$values ('pending'::text, null::text, 'b5100003-0000-4000-8000-000000000002'::text)$$,
    'a tarefa pendente fica sem responsável, continua pendente e mantém o autor original'
);

-- Nada é apagado em cascata
select is((select count(*) from public.messages where external_message_id = 'rm-msg-1'), 1::bigint, 'mensagens preservadas');
select is((select count(*) from public.internal_notes where id = 'b5100009-0000-4000-8000-000000000001' and author_member_id = 'b5100003-0000-4000-8000-000000000002'), 1::bigint, 'nota interna preservada com a autoria original');
select is((select count(*) from public.opportunities where workspace_id = 'b5100002-0000-4000-8000-000000000001'), 2::bigint, 'oportunidades preservadas');
select is((select count(*) from public.app_users where id = 'b5100001-0000-4000-8000-000000000002'), 1::bigint, 'o cadastro do usuário permanece (histórico)');

-- Auditoria
select results_eq(
    $$select action, actor_member_id::text, target_id::text, result from public.audit_events where action = 'team.member_removed'$$,
    $$values ('team.member_removed'::text, 'b5100003-0000-4000-8000-000000000001'::text, 'b5100003-0000-4000-8000-000000000002'::text, 'success'::text)$$,
    'a remoção é auditada com o OWNER como autor'
);
select is(
    (select metadata->>'ended_conversation_assignments' || '/' || (metadata->>'cleared_opportunities') || '/' || (metadata->>'cleared_tasks') from public.audit_events where action = 'team.member_removed'),
    '1/1/1',
    'a auditoria resume o que foi liberado (atribuições, oportunidades, tarefas), sem conteúdo privado'
);
select is(
    (select count(*) from public.audit_events where action = 'opportunity.responsible_cleared' and target_id = 'b5100007-0000-4000-8000-000000000001'),
    1::bigint,
    'cada oportunidade liberada ganha seu evento de auditoria'
);

-- Não reutiliza o vínculo removido
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
select throws_ok(
    $$select public.reactivate_team_member('b5100003-0000-4000-8000-000000000002')$$,
    '55000', 'team_member_not_reactivatable',
    'membro removido não pode ser reativado (exige novo convite)'
);
select throws_ok(
    $$select public.remove_team_member('b5100003-0000-4000-8000-000000000002')$$,
    '55000', 'team_member_not_removable',
    'remover duas vezes é recusado'
);
select is(
    (select count(*) from public.get_team_members() where member_id = 'b5100003-0000-4000-8000-000000000002'),
    0::bigint,
    'o removido sai da lista de equipe'
);

-- Convite pendente também pode ser cancelado (removido)
select is(
    (select public.remove_team_member('b5100003-0000-4000-8000-000000000004')->>'status'),
    'removed',
    'convite pendente é cancelado pela mesma operação'
);
reset role;
select is(
    (select count(*) from public.audit_events where action = 'team.member_removed'),
    2::bigint,
    'o cancelamento do convite também é auditado'
);

-- Suspenso também pode ser removido
update public.workspace_members set status = 'suspended', suspended_at = now() where id = 'b5100003-0000-4000-8000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5100000-0000-4000-8000-000000000001';
select is(
    (select public.remove_team_member('b5100003-0000-4000-8000-000000000003')->>'status'),
    'removed',
    'membro suspenso também pode ser removido'
);

-- Novo convite para o mesmo e-mail cria um vínculo novo (o removido não é reaproveitado)
select isnt(
    (select public.prepare_team_invitation('RM Atendente A Novo', 'rm-a@example.test')->>'member_id'),
    'b5100003-0000-4000-8000-000000000002',
    'reconvidar o mesmo e-mail cria um vínculo novo, sem reaproveitar o removido'
);

reset role;
select is(
    (select status from public.workspace_members where id = 'b5100003-0000-4000-8000-000000000002'),
    'removed',
    'o vínculo removido continua removido depois do novo convite'
);

select * from finish();
rollback;
