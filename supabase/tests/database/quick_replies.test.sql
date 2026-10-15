begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(54);

-- ─── Fixtures: workspace A (owner + 2 atendentes) e workspace B (owner) ─────────────────────────
insert into auth.users (id, email)
values
    ('b5200000-0000-4000-8000-000000000001', 'qr-owner-a@example.test'),
    ('b5200000-0000-4000-8000-000000000002', 'qr-att1-a@example.test'),
    ('b5200000-0000-4000-8000-000000000003', 'qr-att2-a@example.test'),
    ('b5200000-0000-4000-8000-000000000004', 'qr-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5200001-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000001', 'QR Owner A', 'active'),
    ('b5200001-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002', 'QR Att1 A', 'active'),
    ('b5200001-0000-4000-8000-000000000003', 'b5200000-0000-4000-8000-000000000003', 'QR Att2 A', 'active'),
    ('b5200001-0000-4000-8000-000000000004', 'b5200000-0000-4000-8000-000000000004', 'QR Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b5200002-0000-4000-8000-000000000001', 'QR Workspace A', 'active', 'America/Maceio'),
    ('b5200002-0000-4000-8000-000000000002', 'QR Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5200003-0000-4000-8000-000000000001', 'b5200002-0000-4000-8000-000000000001', 'b5200001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5200003-0000-4000-8000-000000000002', 'b5200002-0000-4000-8000-000000000001', 'b5200001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5200003-0000-4000-8000-000000000001'),
    ('b5200003-0000-4000-8000-000000000003', 'b5200002-0000-4000-8000-000000000001', 'b5200001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b5200003-0000-4000-8000-000000000001'),
    ('b5200003-0000-4000-8000-000000000004', 'b5200002-0000-4000-8000-000000000002', 'b5200001-0000-4000-8000-000000000004', 'owner', 'active', now(), null);

-- ─── Permissões e forma das funções ──────────────────────────────────────────────────────────────
select ok(
    (select bool_and(
        pg_catalog.has_function_privilege('authenticated', f, 'execute')
        and not pg_catalog.has_function_privilege('anon', f, 'execute')
        and not pg_catalog.has_function_privilege('service_role', f, 'execute'))
     from unnest(array[
        'public.get_quick_replies()',
        'public.save_quick_reply_category(uuid, text)',
        'public.delete_quick_reply_category(uuid)',
        'public.save_quick_reply(uuid, text, text, uuid, boolean)',
        'public.delete_quick_reply(uuid)',
        'public.record_quick_reply_use(uuid)',
        'public.add_example_quick_replies()']) as f),
    'respostas rápidas: só usuário autenticado executa (nunca anon nem service_role)'
);
select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']::text[])
     from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('get_quick_replies', 'save_quick_reply_category', 'delete_quick_reply_category',
                         'save_quick_reply', 'delete_quick_reply', 'record_quick_reply_use', 'add_example_quick_replies')),
    'funções de respostas rápidas: SECURITY DEFINER com search_path vazio'
);
select ok(
    (select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
     where c.oid in ('public.quick_replies'::regclass, 'public.quick_reply_categories'::regclass)),
    'RLS ligada nas duas tabelas'
);
select ok(
    not pg_catalog.has_table_privilege('authenticated', 'public.quick_replies', 'insert')
    and not pg_catalog.has_table_privilege('authenticated', 'public.quick_replies', 'update')
    and not pg_catalog.has_table_privilege('authenticated', 'public.quick_replies', 'delete')
    and not pg_catalog.has_table_privilege('authenticated', 'public.quick_reply_categories', 'insert')
    and not pg_catalog.has_table_privilege('authenticated', 'public.quick_reply_categories', 'update')
    and not pg_catalog.has_table_privilege('authenticated', 'public.quick_reply_categories', 'delete')
    and not pg_catalog.has_table_privilege('anon', 'public.quick_replies', 'select')
    and not pg_catalog.has_table_privilege('service_role', 'public.quick_replies', 'select'),
    'tabelas: escrita direta negada, anon e service_role sem leitura'
);

-- ─── Anônimo não acessa ──────────────────────────────────────────────────────────────────────────
set local role anon;
select throws_ok($$select public.get_quick_replies()$$, '42501', null, 'anon não executa get_quick_replies');
select throws_ok($$select * from public.quick_replies$$, '42501', null, 'anon não lê a tabela de respostas');
select throws_ok($$select public.record_quick_reply_use(gen_random_uuid())$$, '42501', null, 'anon não registra uso');
reset role;

-- ─── ATENDENTE 1 cria categoria e resposta (texto preservado exatamente) ─────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000002';

create temp table qr_ids (k text primary key, id uuid not null);
grant all on qr_ids to authenticated;

insert into qr_ids select 'cat1', (public.save_quick_reply_category(null, 'Visitas 🏠')->>'id')::uuid;
select is((select name from public.quick_reply_categories where id = (select id from qr_ids where k = 'cat1')), 'Visitas 🏠', 'atendente cria categoria com emoji no nome');

insert into qr_ids select 'r1', (public.save_quick_reply(
    null, 'Confirmar visita',
    E'Olá, {{nome}}!\n\n*Visita* confirmada:\n• sábado _10h_ 🏠\n• leve o RG\n',
    (select id from qr_ids where k = 'cat1'), true)->>'id')::uuid;
select is(
    (select body from public.quick_replies where id = (select id from qr_ids where k = 'r1')),
    E'Olá, {{nome}}!\n\n*Visita* confirmada:\n• sábado _10h_ 🏠\n• leve o RG\n',
    'texto guardado exatamente: quebras de linha, lista, emoji e marcação do WhatsApp'
);
select is((select use_count from public.quick_replies where id = (select id from qr_ids where k = 'r1')), 0, 'contador de uso começa em zero');

select throws_ok($$select public.save_quick_reply_category(null, 'visitas 🏠')$$, '23505', null, 'categoria duplicada (sem diferenciar maiúsculas) é recusada');
select throws_ok($$select public.save_quick_reply_category(null, '   ')$$, '22023', null, 'nome de categoria vazio é recusado');
select throws_ok($$select public.save_quick_reply_category(null, repeat('a', 41))$$, '22023', null, 'nome de categoria acima de 40 caracteres é recusado');
select lives_ok($$select public.save_quick_reply_category(null, repeat('b', 40))$$, 'nome de categoria com 40 caracteres é aceito');
select throws_ok($$select public.save_quick_reply(null, repeat('t', 61), 'texto', null, true)$$, '22023', null, 'título acima de 60 caracteres é recusado');
select lives_ok($$select public.save_quick_reply(null, repeat('t', 60), 'texto', null, true)$$, 'título com 60 caracteres é aceito');
select throws_ok($$select public.save_quick_reply(null, 'Longa', repeat('x', 4001), null, true)$$, '22023', null, 'texto acima de 4000 caracteres é recusado');
select lives_ok($$select public.save_quick_reply(null, 'Longa', repeat('x', 4000), null, false)$$, 'texto com 4000 caracteres é aceito (inativa)');
select throws_ok($$select public.save_quick_reply(null, 'Vazia', E' \n ', null, true)$$, '22023', null, 'texto só com espaços é recusado');
select throws_ok($$select public.save_quick_reply(null, '', 'texto', null, true)$$, '22023', null, 'título vazio é recusado');
select throws_ok(
    $$select public.save_quick_reply(null, 'Categoria fantasma', 'texto', gen_random_uuid(), true)$$,
    'P0002', null, 'categoria inexistente é recusada'
);

-- ─── ATENDENTE 2 cria a dele ─────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000003';
insert into qr_ids select 'r2', (public.save_quick_reply(null, 'Boas-vindas do 2', 'Oi, {{nome}}! Sou {{meu_nome}}.', null, true)->>'id')::uuid;

-- Atendente 2 vê tudo do workspace (equipe inteira) e pode usar
select is(
    (select jsonb_array_length(public.get_quick_replies()->'replies')),
    4,
    'atendente enxerga as respostas da equipe (todas do workspace)'
);
select is((public.record_quick_reply_use((select id from qr_ids where k = 'r1'))->>'use_count')::int, 1, 'qualquer membro registra um uso de resposta de outro');
select is(
    (select last_used_at is not null from public.quick_replies where id = (select id from qr_ids where k = 'r1')),
    true, 'registro de uso grava a data do último uso'
);

-- Atendente 2 NÃO edita nem apaga as do atendente 1
select throws_ok(
    format($$select public.save_quick_reply(%L, 'Invadido', 'texto', null, true)$$, (select id from qr_ids where k = 'r1')),
    '42501', null, 'atendente não edita a resposta de outro'
);
select throws_ok(
    format($$select public.delete_quick_reply(%L)$$, (select id from qr_ids where k = 'r1')),
    '42501', null, 'atendente não apaga a resposta de outro'
);
select throws_ok(
    format($$select public.save_quick_reply_category(%L, 'Invadida')$$, (select id from qr_ids where k = 'cat1')),
    '42501', null, 'atendente não renomeia a categoria de outro'
);
select throws_ok(
    format($$select public.delete_quick_reply_category(%L)$$, (select id from qr_ids where k = 'cat1')),
    '42501', null, 'atendente não apaga a categoria de outro'
);
select throws_ok($$update public.quick_replies set title = 'x'$$, '42501', null, 'escrita direta na tabela é negada');
-- Mas usa a categoria de outro numa resposta própria, e edita a própria
select lives_ok(
    format($$select public.save_quick_reply(%L, 'Boas-vindas do 2 (editada)', 'Oi, {{nome}}!', %L, true)$$,
           (select id from qr_ids where k = 'r2'), (select id from qr_ids where k = 'cat1')),
    'atendente edita a própria resposta e a coloca na categoria de outro membro'
);

-- ─── DONO edita e apaga qualquer uma ─────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000001';
select lives_ok(
    format($$select public.save_quick_reply(%L, 'Confirmar visita (dono)', 'Texto do dono', %L, true)$$,
           (select id from qr_ids where k = 'r1'), (select id from qr_ids where k = 'cat1')),
    'dono edita a resposta de um atendente'
);
select is((select title from public.quick_replies where id = (select id from qr_ids where k = 'r1')), 'Confirmar visita (dono)', 'edição do dono foi gravada');
select lives_ok(
    format($$select public.save_quick_reply_category(%L, 'Visitas e plantões')$$, (select id from qr_ids where k = 'cat1')),
    'dono renomeia a categoria de um atendente'
);

-- Apagar categoria NÃO apaga respostas: voltam para "sem categoria"
select is(
    (public.delete_quick_reply_category((select id from qr_ids where k = 'cat1'))->>'replies_moved')::int,
    2, 'dono apaga categoria de atendente: 2 respostas movidas'
);
select is(
    (select count(*)::int from public.quick_replies where id in (select id from qr_ids where k in ('r1', 'r2')) and category_id is null),
    2, 'respostas continuam existindo, agora sem categoria'
);
select is((select count(*)::int from public.quick_reply_categories where id = (select id from qr_ids where k = 'cat1')), 0, 'a categoria foi apagada');

select lives_ok(
    format($$select public.delete_quick_reply(%L)$$, (select id from qr_ids where k = 'r2')),
    'dono apaga a resposta de um atendente'
);

-- ─── Atendente 1 apaga a própria ─────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000002';
select lives_ok(
    format($$select public.delete_quick_reply(%L)$$, (select id from qr_ids where k = 'r1')),
    'atendente apaga a própria resposta'
);

-- ─── Outro workspace não lê nem escreve ──────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000004';
select is((select count(*)::int from public.quick_replies), 0, 'owner de outro workspace não lê respostas (tabela)');
select is((select count(*)::int from public.quick_reply_categories), 0, 'owner de outro workspace não lê categorias (tabela)');
select is(public.get_quick_replies()->'replies', '[]'::jsonb, 'owner de outro workspace não recebe respostas pela função');
-- recria uma no A (como dono A) para testar o acesso cruzado
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000001';
insert into qr_ids select 'ra', (public.save_quick_reply(null, 'Só do A', 'Segredo do workspace A', null, true)->>'id')::uuid;
insert into qr_ids select 'ca', (public.save_quick_reply_category(null, 'Só do A')->>'id')::uuid;
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000004';
select throws_ok(
    format($$select public.save_quick_reply(%L, 'Cruzado', 'texto', null, true)$$, (select id from qr_ids where k = 'ra')),
    'P0002', null, 'owner de outro workspace não edita resposta alheia'
);
select throws_ok(
    format($$select public.delete_quick_reply(%L)$$, (select id from qr_ids where k = 'ra')),
    'P0002', null, 'owner de outro workspace não apaga resposta alheia'
);
select throws_ok(
    format($$select public.save_quick_reply(null, 'Cruzado', 'texto', %L, true)$$, (select id from qr_ids where k = 'ca')),
    'P0002', null, 'não é possível usar a categoria de outro workspace'
);
select throws_ok(
    format($$select public.record_quick_reply_use(%L)$$, (select id from qr_ids where k = 'ra')),
    'P0002', null, 'contador de uso não incrementa para quem é de outro workspace'
);
select throws_ok(
    format($$select public.delete_quick_reply_category(%L)$$, (select id from qr_ids where k = 'ca')),
    'P0002', null, 'owner de outro workspace não apaga categoria alheia'
);

-- ─── Exemplos: ação do usuário, só com a lista vazia ─────────────────────────────────────────────
select is((public.add_example_quick_replies()->>'count')::int, 5, 'adicionar exemplos cria 5 modelos na lista vazia');
select is((select count(*)::int from public.quick_replies where body like '%{{nome}}%'), 5, 'os 5 modelos usam as variáveis');
select throws_ok($$select public.add_example_quick_replies()$$, '55000', null, 'exemplos não são adicionados de novo quando já há respostas');
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000001';
select throws_ok($$select public.add_example_quick_replies()$$, '55000', null, 'exemplos também não entram em workspace que já tem respostas');

-- ─── Auditoria sem texto ─────────────────────────────────────────────────────────────────────────
reset role;
select ok(
    (select count(*) >= 8 from public.audit_events
     where workspace_id = 'b5200002-0000-4000-8000-000000000001' and action like 'quick\_reply.%'),
    'criar, editar e apagar geram eventos de auditoria'
);
select is(
    (select count(*)::int from public.audit_events
     where workspace_id = 'b5200002-0000-4000-8000-000000000001' and action like 'quick\_reply.%'
       and (metadata::text like '%Olá%' or metadata::text like '%Segredo%' or metadata::text like '%Visitas%' or metadata::text like '%Texto do dono%')),
    0, 'a auditoria não guarda título nem texto das respostas'
);

-- ─── Membro desativado perde o acesso ────────────────────────────────────────────────────────────
update public.workspace_members set status = 'suspended', suspended_at = now() where id = 'b5200003-0000-4000-8000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5200000-0000-4000-8000-000000000003';
select throws_ok($$select public.get_quick_replies()$$, '42501', null, 'funcionário desativado não acessa mais');
select is((select count(*)::int from public.quick_replies), 0, 'funcionário desativado não lê a tabela');

select * from finish();
rollback;
