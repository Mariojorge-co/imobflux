begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(29);

-- ─── Fixtures: OWNER, atendente A (ativo), atendente C (ativo em OUTRO workspace) ──────────────
insert into auth.users (id, email)
values
    ('b5700000-0000-4000-8000-000000000001', 'ri-owner@example.test'),
    ('b5700000-0000-4000-8000-000000000002', 'ri-a@example.test'),
    ('b5700000-0000-4000-8000-000000000003', 'ri-c@example.test'),
    ('b5700000-0000-4000-8000-000000000009', 'ri-other-owner@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5700001-0000-4000-8000-000000000001', 'b5700000-0000-4000-8000-000000000001', 'RI Owner', 'active'),
    ('b5700001-0000-4000-8000-000000000002', 'b5700000-0000-4000-8000-000000000002', 'RI Atendente A', 'active'),
    ('b5700001-0000-4000-8000-000000000003', 'b5700000-0000-4000-8000-000000000003', 'RI Atendente C', 'active'),
    ('b5700001-0000-4000-8000-000000000009', 'b5700000-0000-4000-8000-000000000009', 'RI Outro Owner', 'active');

insert into public.workspaces (id, name, status, timezone)
values
    ('b5700002-0000-4000-8000-000000000001', 'RI Workspace', 'active', 'America/Maceio'),
    ('b5700002-0000-4000-8000-000000000009', 'RI Outro Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5700003-0000-4000-8000-000000000001', 'b5700002-0000-4000-8000-000000000001', 'b5700001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5700003-0000-4000-8000-000000000002', 'b5700002-0000-4000-8000-000000000001', 'b5700001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5700003-0000-4000-8000-000000000001'),
    ('b5700003-0000-4000-8000-000000000009', 'b5700002-0000-4000-8000-000000000009', 'b5700001-0000-4000-8000-000000000009', 'owner', 'active', now(), null),
    -- C trabalha (ativo) no OUTRO workspace
    ('b5700003-0000-4000-8000-000000000003', 'b5700002-0000-4000-8000-000000000009', 'b5700001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b5700003-0000-4000-8000-000000000009');

-- ─── Remover A e reconvidar o mesmo e-mail ───────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';

select is((select public.remove_team_member('b5700003-0000-4000-8000-000000000002')->>'status'), 'removed', 'A é removido');

select set_config('ri.invite', public.prepare_team_invitation('Nome Digitado Agora', 'ri-a@example.test')::text, true);

select ok(current_setting('ri.invite')::jsonb->>'member_id' is not null, 'reconvidar o e-mail de um removido cria um convite');
select is((current_setting('ri.invite')::jsonb->>'identity_reused')::boolean, true, 'o convite informa que a identidade existente foi reaproveitada');
select isnt(current_setting('ri.invite')::jsonb->>'member_id', 'b5700003-0000-4000-8000-000000000002', 'o convite é um vínculo NOVO (o removido não é reaproveitado)');

reset role;
select is(
    (select count(*) from public.app_users where auth_user_id = 'b5700000-0000-4000-8000-000000000002'),
    1::bigint,
    'continua existindo UM app_users para esse acesso (sem registro duplicado)'
);
select is(
    (select user_id::text from public.workspace_members where id = (current_setting('ri.invite')::jsonb->>'member_id')::uuid),
    'b5700001-0000-4000-8000-000000000002',
    'o novo vínculo aponta para o app_users já existente'
);
select results_eq(
    $$select status, role from public.workspace_members where id = (current_setting('ri.invite')::jsonb->>'member_id')::uuid$$,
    $$values ('invited'::text, 'attendant'::text)$$,
    'o novo vínculo nasce como convidado (sem acesso até aceitar)'
);
select is(
    (select status from public.workspace_members where id = 'b5700003-0000-4000-8000-000000000002'),
    'removed',
    'o vínculo antigo continua removido'
);
select is(
    (select display_name from public.app_users where id = 'b5700001-0000-4000-8000-000000000002'),
    'RI Atendente A',
    'o nome da identidade existente não é sobrescrito pelo convite'
);

-- Sem acesso até aceitar
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000002';
select is((select count(*) from private.active_member_context()), 0::bigint, 'convidado ainda não tem acesso ativo');

-- O OWNER vê o convite pendente já ligado ao acesso (é o que o reenvio usa)
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select is(
    (select auth_user_id::text from public.get_pending_team_invitation((current_setting('ri.invite')::jsonb->>'member_id')::uuid)),
    'b5700000-0000-4000-8000-000000000002',
    'get_pending_team_invitation já traz o acesso vinculado (reenvio usa o ramo de e-mail de acesso)'
);
select throws_ok(
    $$select public.prepare_team_invitation('Outra vez', 'ri-a@example.test')$$,
    '23505', 'team_invitation_already_pending',
    'não cria um segundo convite enquanto o primeiro está pendente'
);

-- ─── Aceitar o convite ───────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000002';
select is((select public.accept_team_invitation()->>'success'), 'true', 'o reconvidado ACEITA o convite');
select is((select count(*) from private.active_member_context()), 1::bigint, 'e volta a ter acesso ativo');
select is(
    (select member_role from private.active_member_context()),
    'attendant',
    'com o papel de atendente'
);

reset role;
select results_eq(
    $$select status, (activated_at is not null) from public.workspace_members where id = (current_setting('ri.invite')::jsonb->>'member_id')::uuid$$,
    $$values ('active'::text, true)$$,
    'o novo vínculo fica ativo'
);
select is(
    (select count(*) from public.workspace_members where user_id = 'b5700001-0000-4000-8000-000000000002' and status = 'active'),
    1::bigint,
    'só um vínculo ativo para essa pessoa'
);
select is(
    (select status from public.workspace_members where id = 'b5700003-0000-4000-8000-000000000002'),
    'removed',
    'o vínculo antigo continua removido depois do aceite'
);

-- ─── Equipe e auditoria ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select is(
    (select count(*) from public.get_team_members() where display_name = 'RI Atendente A'),
    1::bigint,
    'a lista de equipe mostra a pessoa uma vez (o removido não aparece)'
);
reset role;
select is(
    (select count(*) from public.audit_events where action = 'team.invitation_created' and target_id = (current_setting('ri.invite')::jsonb->>'member_id')::uuid),
    1::bigint,
    'o reconvite é auditado'
);
select is(
    (select (metadata->>'identity_reused')::boolean from public.audit_events where action = 'team.invitation_created' and target_id = (current_setting('ri.invite')::jsonb->>'member_id')::uuid),
    true,
    'a auditoria registra que a identidade foi reaproveitada (sem e-mail nem nome)'
);

-- ─── E-mail novo continua criando identidade nova ────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select is(
    (select (public.prepare_team_invitation('Pessoa Nova', 'ri-novo@example.test')->>'identity_reused')::boolean),
    false,
    'e-mail nunca visto cria identidade nova (sem acesso vinculado ainda)'
);

-- ─── Pessoa ativa em OUTRO workspace não é reaproveitada ───────────────────────────────────────────
select throws_ok(
    $$select public.prepare_team_invitation('Atendente C', 'ri-c@example.test')$$,
    '55000', 'team_identity_unavailable',
    'quem tem vínculo ativo em outro workspace não pode ser convidado (evita dois contextos ativos)'
);

-- Quem não é OWNER continua sem poder convidar
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000002';
select throws_ok(
    $$select public.prepare_team_invitation('X', 'ri-x@example.test')$$,
    '42501', 'team_management_not_authorized',
    'ATTENDANT continua sem poder convidar'
);

-- Identidade inativa não é reaproveitada
reset role;
insert into auth.users (id, email) values ('b5700000-0000-4000-8000-000000000005', 'ri-inativo@example.test');
insert into public.app_users (id, auth_user_id, display_name, status, deactivated_at)
values ('b5700001-0000-4000-8000-000000000005', 'b5700000-0000-4000-8000-000000000005', 'RI Inativo', 'inactive', now());
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select throws_ok(
    $$select public.prepare_team_invitation('RI Inativo', 'ri-inativo@example.test')$$,
    '55000', 'team_identity_unavailable',
    'identidade desativada não é reaproveitada'
);

-- Reaproveitar não dá a ninguém acesso a outro e-mail: o e-mail do convite continua o do acesso
reset role;
select is(
    (select invited_email_normalized from public.workspace_members where id = (current_setting('ri.invite')::jsonb->>'member_id')::uuid),
    'ri-a@example.test',
    'o convite guarda o e-mail normalizado do acesso'
);

-- E-mail que já está no Auth mas nunca teve app_users: cria identidade nova com o nome digitado
reset role;
insert into auth.users (id, email) values ('b5700000-0000-4000-8000-000000000006', 'ri-sem-app@example.test');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5700000-0000-4000-8000-000000000001';
select set_config('ri.noapp', public.prepare_team_invitation('Nome Para Quem Nao Tinha Cadastro', 'ri-sem-app@example.test')::text, true);
select is((current_setting('ri.noapp')::jsonb->>'identity_reused')::boolean, false, 'acesso existente sem cadastro de usuário: identidade nova (nada a reaproveitar)');
reset role;
select is(
    (select app_user.display_name from public.workspace_members m join public.app_users app_user on app_user.id = m.user_id where m.id = (current_setting('ri.noapp')::jsonb->>'member_id')::uuid),
    'Nome Para Quem Nao Tinha Cadastro',
    'e o nome digitado pelo dono é usado'
);
select is(
    (select count(*) from public.app_users where auth_user_id is null and display_name = 'Nome Para Quem Nao Tinha Cadastro'),
    1::bigint,
    'criando exatamente um cadastro novo, ainda sem acesso vinculado'
);

select * from finish();
rollback;
