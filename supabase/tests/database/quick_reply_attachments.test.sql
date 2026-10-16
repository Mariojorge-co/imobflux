begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(24);

insert into auth.users (id, email)
values
    ('b6400000-0000-4000-8000-000000000001', 'qa-owner-a@example.test'),
    ('b6400000-0000-4000-8000-000000000002', 'qa-att1-a@example.test'),
    ('b6400000-0000-4000-8000-000000000003', 'qa-att2-a@example.test'),
    ('b6400000-0000-4000-8000-000000000004', 'qa-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b6400001-0000-4000-8000-000000000001', 'b6400000-0000-4000-8000-000000000001', 'QA Owner A', 'active'),
    ('b6400001-0000-4000-8000-000000000002', 'b6400000-0000-4000-8000-000000000002', 'QA Att1 A', 'active'),
    ('b6400001-0000-4000-8000-000000000003', 'b6400000-0000-4000-8000-000000000003', 'QA Att2 A', 'active'),
    ('b6400001-0000-4000-8000-000000000004', 'b6400000-0000-4000-8000-000000000004', 'QA Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b6400002-0000-4000-8000-000000000001', 'QA Workspace A', 'active', 'America/Maceio'),
    ('b6400002-0000-4000-8000-000000000002', 'QA Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b6400003-0000-4000-8000-000000000001', 'b6400002-0000-4000-8000-000000000001', 'b6400001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b6400003-0000-4000-8000-000000000002', 'b6400002-0000-4000-8000-000000000001', 'b6400001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b6400003-0000-4000-8000-000000000001'),
    ('b6400003-0000-4000-8000-000000000003', 'b6400002-0000-4000-8000-000000000001', 'b6400001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b6400003-0000-4000-8000-000000000001'),
    ('b6400003-0000-4000-8000-000000000004', 'b6400002-0000-4000-8000-000000000002', 'b6400001-0000-4000-8000-000000000004', 'owner', 'active', now(), null);

-- Respostas: r_owner (do dono) e r_att1 (do atendente 1)
create temp table qa_ids (name text primary key, id uuid not null);
grant select, insert on qa_ids to authenticated;

set local role authenticated;
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000001';
insert into qa_ids select 'r_owner', (public.save_quick_reply(null, 'Do dono', 'Texto do dono', null, true)->>'id')::uuid;
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000002';
insert into qa_ids select 'r_att1', (public.save_quick_reply(null, 'Do atendente 1', 'Texto do atendente', null, true)->>'id')::uuid;

-- ─── Dono anexa na própria resposta ──────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000001';
select is(
    public.add_quick_reply_attachment(
        (select id from qa_ids where name = 'r_owner'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_owner') || '/aaa1',
        'tabela.pdf', 'application/pdf', 1000, 'document')->>'status',
    'success', 'o dono anexa um arquivo à própria resposta');
select is(
    (public.add_quick_reply_attachment(
        (select id from qa_ids where name = 'r_owner'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_owner') || '/aaa2',
        'foto.jpg', 'image/jpeg', 2000, 'image')->>'position')::int,
    1, 'a posição é sequencial');

-- o dono anexa na resposta do atendente (owner edita tudo)
select is(
    public.add_quick_reply_attachment(
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/bbb1',
        'a.pdf', 'application/pdf', 10, 'document')->>'status',
    'success', 'o dono também anexa na resposta de um atendente');

-- ─── Atendente: só nas respostas dele ────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000002';
select throws_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'x.pdf', 'application/pdf', 10, 'document')$q$,
        (select id from qa_ids where name = 'r_owner'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_owner') || '/ccc1'),
    '42501', 'quick_reply_not_authorized', 'o atendente não anexa na resposta do dono');
select is(
    public.add_quick_reply_attachment(
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/ddd1',
        'b.pdf', 'application/pdf', 10, 'document')->>'status',
    'success', 'o atendente anexa na própria resposta');

-- ─── Validações ──────────────────────────────────────────────────────────────────────────────────
select throws_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'x.pdf', 'application/pdf', 26214401, 'document')$q$,
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/eee1'),
    '22023', 'quick_reply_attachment_invalid', 'mais de 25 MB é recusado');
select throws_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'x.pdf', 'application/pdf', 0, 'document')$q$,
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/eee2'),
    '22023', 'quick_reply_attachment_invalid', 'arquivo vazio é recusado');
select throws_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'x.pdf', 'application/pdf', 10, 'sticker')$q$,
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/eee3'),
    '22023', 'quick_reply_attachment_invalid', 'tipo de mídia desconhecido é recusado');
select throws_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'x.pdf', 'application/pdf', 10, 'document')$q$,
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000002/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/eee4'),
    '22023', 'quick_reply_attachment_invalid', 'caminho de outro workspace é recusado');
select throws_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'x.pdf', 'application/pdf', 10, 'document')$q$,
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_owner') || '/eee5'),
    '22023', 'quick_reply_attachment_invalid', 'caminho de outra resposta é recusado');

-- limite de 5: já há 2 (dono + atendente) na r_att1; completa até 5 e o 6º falha
select lives_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'c.pdf', 'application/pdf', 10, 'document'),
                     public.add_quick_reply_attachment(%L, %L, 'd.pdf', 'application/pdf', 10, 'document'),
                     public.add_quick_reply_attachment(%L, %L, 'e.pdf', 'application/pdf', 10, 'document')$q$,
        (select id from qa_ids where name = 'r_att1'), 'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/f1',
        (select id from qa_ids where name = 'r_att1'), 'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/f2',
        (select id from qa_ids where name = 'r_att1'), 'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/f3'),
    'chega a 5 anexos');
select throws_ok(
    format($q$select public.add_quick_reply_attachment(%L, %L, 'g.pdf', 'application/pdf', 10, 'document')$q$,
        (select id from qa_ids where name = 'r_att1'),
        'b6400002-0000-4000-8000-000000000001/quick-replies/' || (select id from qa_ids where name = 'r_att1') || '/f4'),
    '22023', 'quick_reply_attachment_limit', 'o 6º anexo é recusado');

-- ─── Leitura: equipe vê tudo do workspace; outro workspace não vê nada; sem caminho do arquivo ───
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000003';
select is(jsonb_array_length(public.get_quick_reply_attachments()), 7, 'outro atendente do mesmo workspace vê os 7 anexos (2 do dono + 5 do atendente)');
select ok(not (public.get_quick_reply_attachments()::text like '%storage_path%' or public.get_quick_reply_attachments()::text like '%quick-replies/%'),
    'a leitura não expõe o caminho do arquivo');
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000004';
select is(jsonb_array_length(public.get_quick_reply_attachments()), 0, 'o outro workspace não vê nenhum');

-- ─── Remover ─────────────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000003';
select throws_ok(
    format($q$select public.remove_quick_reply_attachment(%L)$q$, (select (public.get_quick_reply_attachments()->0->>'id'))),
    '42501', 'quick_reply_not_authorized', 'quem não criou a resposta (e não é dono) não remove anexo dela');
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000004';
select throws_ok(
    format($q$select public.remove_quick_reply_attachment(%L)$q$, gen_random_uuid()),
    'P0002', 'quick_reply_not_found', 'anexo inexistente (ou de outro workspace) não é encontrado');
set local "request.jwt.claim.sub" = 'b6400000-0000-4000-8000-000000000001';
select ok(
    (public.remove_quick_reply_attachment((select (e->>'id')::uuid from jsonb_array_elements(public.get_quick_reply_attachments()) e where e->>'file_name' = 'tabela.pdf'))->>'storage_path') like 'b6400002-0000-4000-8000-000000000001/quick-replies/%',
    'o dono remove e recebe o caminho para apagar o arquivo');
select is(jsonb_array_length(public.get_quick_reply_attachments()), 6, 'sobram 6');

-- apagar a resposta apaga os anexos (cascata)
select public.delete_quick_reply((select id from qa_ids where name = 'r_att1'));
select is(jsonb_array_length(public.get_quick_reply_attachments()), 1, 'apagar a resposta apaga os registros de anexo dela');

-- ─── Auditoria sem nome de arquivo e privilégios ─────────────────────────────────────────────────
reset role;
select ok(
    (select count(*) from public.audit_events where action like 'quick_reply.attachment_%' and workspace_id = 'b6400002-0000-4000-8000-000000000001') >= 8
    and not exists (select 1 from public.audit_events where action like 'quick_reply.attachment_%' and metadata::text like '%.pdf%'),
    'auditoria registra adicionar/remover sem o nome do arquivo');
select ok(
    (select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
                     and not has_function_privilege('service_role', f, 'execute'))
     from unnest(array['public.get_quick_reply_attachments()',
                       'public.add_quick_reply_attachment(uuid, text, text, text, bigint, text)',
                       'public.remove_quick_reply_attachment(uuid)']) as f),
    'só o usuário logado executa as funções de anexo');
select ok(
    (select c.relrowsecurity from pg_class c where c.oid = 'public.quick_reply_attachments'::regclass)
    and not has_table_privilege('authenticated', 'public.quick_reply_attachments', 'insert')
    and not has_table_privilege('authenticated', 'public.quick_reply_attachments', 'delete')
    and not has_table_privilege('anon', 'public.quick_reply_attachments', 'select'),
    'RLS ligada; sem escrita direta; anon não lê');
select ok(
    (select p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = 'public.add_quick_reply_attachment(uuid, text, text, text, bigint, text)'::regprocedure)
    and (select not p.prosecdef and 'search_path=""' = any (p.proconfig) from pg_proc p where p.oid = 'public.get_quick_reply_attachments()'::regprocedure),
    'escrita: DEFINER com search_path vazio; leitura: INVOKER com search_path vazio');

select * from finish();
rollback;
