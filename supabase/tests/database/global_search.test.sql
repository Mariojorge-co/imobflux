begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(20);

insert into auth.users (id, email)
values
    ('b6500000-0000-4000-8000-000000000001', 'gs-owner@example.test'),
    ('b6500000-0000-4000-8000-000000000002', 'gs-att@example.test'),
    ('b6500000-0000-4000-8000-000000000003', 'gs-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b6500001-0000-4000-8000-000000000001', 'b6500000-0000-4000-8000-000000000001', 'GS Owner', 'active'),
    ('b6500001-0000-4000-8000-000000000002', 'b6500000-0000-4000-8000-000000000002', 'GS Att', 'active'),
    ('b6500001-0000-4000-8000-000000000003', 'b6500000-0000-4000-8000-000000000003', 'GS Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b6500002-0000-4000-8000-000000000001', 'GS Workspace A', 'active', 'America/Maceio'),
    ('b6500002-0000-4000-8000-000000000002', 'GS Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b6500003-0000-4000-8000-000000000001', 'b6500002-0000-4000-8000-000000000001', 'b6500001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b6500003-0000-4000-8000-000000000002', 'b6500002-0000-4000-8000-000000000001', 'b6500001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b6500003-0000-4000-8000-000000000001'),
    ('b6500003-0000-4000-8000-000000000003', 'b6500002-0000-4000-8000-000000000002', 'b6500001-0000-4000-8000-000000000003', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values
    ('b6500004-0000-4000-8000-000000000001', 'b6500002-0000-4000-8000-000000000001', 'whatsapp', 'gs_instance', '+5582999906500', 'active', now(), true),
    ('b6500004-0000-4000-8000-000000000002', 'b6500002-0000-4000-8000-000000000002', 'whatsapp', 'gs_instance_b', '+5582999906501', 'active', now(), true);

select public.ingest_whatsapp_text_message('gs_instance', 'gs-1', '5582977776501@s.whatsapp.net', false, 'Maria Compradora', 'Quero ver o apartamento do centro', now() - interval '30 minutes');
select public.ingest_whatsapp_text_message('gs_instance', 'gs-2', '5582977776502@s.whatsapp.net', false, 'João Investidor', 'O apartamento tem 100% de financiamento?', now() - interval '20 minutes');
select public.ingest_whatsapp_text_message('gs_instance', 'gs-3', '5582977776503@s.whatsapp.net', false, 'Cliente Protegido', 'Falando do apartamento secreto', now() - interval '10 minutes');
select public.ingest_whatsapp_text_message('gs_instance', 'gs-4', '5582977776501@s.whatsapp.net', false, 'Maria Compradora', 'MENSAGEM ESCONDIDA apartamento', now() - interval '5 minutes');
select public.ingest_whatsapp_text_message('gs_instance', 'gs-5', '5582977776504@s.whatsapp.net', false, 'Texto Longo', repeat('x', 400) || ' palavraachada ' || repeat('y', 400), now() - interval '2 minutes');
select public.ingest_whatsapp_text_message('gs_instance_b', 'gs-b', '5582977776599@s.whatsapp.net', false, 'Cliente B', 'apartamento do outro workspace', now() - interval '3 minutes');

update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582977776503');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582977776503';
update public.messages set hidden_at = now(), hidden_by_member_id = 'b6500003-0000-4000-8000-000000000001' where external_message_id = 'gs-4';

-- ─── Dono ────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6500000-0000-4000-8000-000000000001';
create temp table gs_owner on commit drop as select public.search_global('apartamento') as r;
grant select on gs_owner to authenticated;

select is((select count(*)::int from gs_owner, jsonb_array_elements(r->'results') x where x->>'kind' = 'message'), 3,
    'o dono acha 3 mensagens (a escondida e a do outro workspace ficam de fora)');
select is((select x->>'participant_name' from gs_owner, jsonb_array_elements(r->'results') x where x->>'kind' = 'message' order by x->>'occurred_at' desc limit 1),
    'Cliente Protegido', 'a mais recente vem primeiro (o dono vê o contato protegido)');
select ok((select bool_and(x->>'snippet' ilike '%apartamento%') from gs_owner, jsonb_array_elements(r->'results') x where x->>'kind' = 'message'),
    'o trecho de cada mensagem contém o termo');
select is((select count(*)::int from gs_owner, jsonb_array_elements(r->'results') x where x->>'snippet' ilike '%ESCONDIDA%'), 0, 'mensagem escondida não aparece');
select is((select count(*)::int from jsonb_array_elements(public.search_global('100%')->'results') x), 1, 'o curinga % do termo é literal (acha só quem tem "100%")');
select is((select count(*)::int from jsonb_array_elements(public.search_global('APARTAMENTO')->'results') x where x->>'kind' = 'message'), 3, 'não diferencia maiúsculas de minúsculas');
select is(public.search_global('a')->'results', '[]'::jsonb, 'termo com menos de 2 letras não busca');
select ok((select x->>'snippet' ilike '%palavraachada%' and length(x->>'snippet') <= 200
           from jsonb_array_elements(public.search_global('palavraachada')->'results') x limit 1),
    'texto longo: o trecho de até 200 caracteres está centrado no termo');

-- contato por nome e por telefone
select is((select x->>'kind' || ':' || (x->>'participant_name') from jsonb_array_elements(public.search_global('Compradora')->'results') x limit 1),
    'contact:Maria Compradora', 'acha o contato pelo nome (uma linha por conversa)');
select is((select count(*)::int from jsonb_array_elements(public.search_global('7777650')->'results') x where x->>'kind' = 'contact'), 4,
    'acha contatos pelo telefone (só dígitos, parte do número)');

-- paginação
select is((select jsonb_array_length(public.search_global('apartamento', 2, 0)->'results')), 2, 'página de 2 itens');
select ok((public.search_global('apartamento', 2, 0)->>'has_more')::boolean, 'há mais páginas');
select ok(not (public.search_global('apartamento', 50, 0)->>'has_more')::boolean, 'sem mais páginas quando tudo coube');
select is((select jsonb_array_length(public.search_global('apartamento', 20, 1000)->'results')), 0, 'deslocamento além do fim devolve vazio');

-- ─── Atendente: contato protegido some ───────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6500000-0000-4000-8000-000000000002';
select is((select count(*)::int from jsonb_array_elements(public.search_global('apartamento')->'results') x where x->>'kind' = 'message'), 2,
    'o atendente NÃO acha mensagens do contato protegido (RLS)');
select is((select count(*)::int from jsonb_array_elements(public.search_global('Protegido')->'results') x), 0, 'nem o contato protegido pelo nome');

-- ─── Outro workspace ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6500000-0000-4000-8000-000000000003';
select is((select count(*)::int from jsonb_array_elements(public.search_global('apartamento')->'results') x), 1, 'o outro workspace vê só o dele');

-- ─── Privilégios e forma ─────────────────────────────────────────────────────────────────────────
reset role;
select ok(not has_function_privilege('anon', 'public.search_global(text, integer, integer)', 'execute')
          and not has_function_privilege('service_role', 'public.search_global(text, integer, integer)', 'execute')
          and has_function_privilege('authenticated', 'public.search_global(text, integer, integer)', 'execute'),
    'só o usuário logado executa');
select ok((select not p.prosecdef and p.provolatile = 's' and 'search_path=""' = any (p.proconfig)
           from pg_proc p where p.oid = 'public.search_global(text, integer, integer)'::regprocedure),
    'função de leitura: INVOKER, STABLE e search_path vazio');
select ok(exists (select 1 from pg_indexes where indexname = 'idx_messages_text_trgm' and indexdef ilike '%gin%gin_trgm_ops%'),
    'índice trigram existe na coluna de texto');

select * from finish();
rollback;
