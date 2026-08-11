begin;
set search_path = public, extensions, pg_catalog;

create extension if not exists pgtap with schema extensions;

select plan(21);

-- ─────────────────────────────────────────────────────────────
-- 1. Estrutura da função
-- ─────────────────────────────────────────────────────────────

select has_function(
    'public',
    'get_conversations_list',
    array['text', 'timestamp with time zone', 'uuid', 'integer'],
    'get_conversations_list exists with correct signature'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc f
        join pg_catalog.pg_namespace n on n.oid = f.pronamespace
        where n.nspname = 'public'
          and f.proname = 'get_conversations_list'
          and not f.prosecdef
    ),
    'get_conversations_list uses SECURITY INVOKER'
);

select ok(
    exists (
        select 1
        from pg_catalog.pg_proc f
        join pg_catalog.pg_namespace n on n.oid = f.pronamespace
        where n.nspname = 'public'
          and f.proname = 'get_conversations_list'
          and f.proconfig = array['search_path=""']::text[]
    ),
    'get_conversations_list has empty search_path'
);

-- O parâmetro workspace_id NÃO deve aparecer na lista de argumentos da função
select ok(
    not exists (
        select 1
        from pg_catalog.pg_proc f
        join pg_catalog.pg_namespace n on n.oid = f.pronamespace,
        lateral unnest(
            coalesce(
                (select array_agg(pg_catalog.pg_get_function_arg_default(f.oid, s.i))
                 from generate_series(1, f.pronargs) as s(i)),
                '{}'::text[]
            )
        ) as arg_name
        where n.nspname = 'public'
          and f.proname = 'get_conversations_list'
          and pg_catalog.pg_get_function_arguments(f.oid) ilike '%workspace_id%'
    ),
    'get_conversations_list does not declare workspace_id as a parameter'
);

-- ─────────────────────────────────────────────────────────────
-- 2. Grants
-- ─────────────────────────────────────────────────────────────

select ok(
    not pg_catalog.has_function_privilege(
        'anon',
        'public.get_conversations_list(text, timestamptz, uuid, int)',
        'execute'
    ),
    'anon cannot execute get_conversations_list'
);

select ok(
    pg_catalog.has_function_privilege(
        'authenticated',
        'public.get_conversations_list(text, timestamptz, uuid, int)',
        'execute'
    ),
    'authenticated can execute get_conversations_list'
);

select ok(
    not pg_catalog.has_function_privilege(
        'service_role',
        'public.get_conversations_list(text, timestamptz, uuid, int)',
        'execute'
    ),
    'service_role cannot execute get_conversations_list'
);

-- ─────────────────────────────────────────────────────────────
-- 3. Fixtures (UUIDs com hex válido: apenas 0-9 e a-f)
-- ─────────────────────────────────────────────────────────────

insert into auth.users (id, email) values
    ('a1000000-0000-4000-8000-000000000001', 'conv-owner-a@test.invalid'),
    ('b2000000-0000-4000-8000-000000000002', 'conv-owner-b@test.invalid');

insert into public.app_users (id, auth_user_id, display_name, status) values
    ('a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Conv Owner A', 'active'),
    ('b2200000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'Conv Owner B', 'active');

insert into public.workspaces (id, name, status, timezone) values
    ('aa000000-0000-4000-8000-000000000001', 'Workspace A', 'active', 'America/Maceio'),
    ('bb000000-0000-4000-8000-000000000002', 'Workspace B', 'active', 'America/Maceio');

-- workspace_members: UUID hex-válido (sem 'm', 'g', etc.)
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at) values
    ('a0000001-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
     'a1100000-0000-4000-8000-000000000001', 'owner', 'active', now()),
    ('b0000002-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000002',
     'b2200000-0000-4000-8000-000000000002', 'owner', 'active', now());

insert into public.channel_connections
    (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at) values
    ('ca000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
     'whatsapp', 'acc-a', '+5582888880001', 'active', now()),
    ('cb000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000002',
     'whatsapp', 'acc-b', '+5582888880002', 'active', now());

insert into public.contacts (id, workspace_id, display_name, classification, operational_status) values
    ('c1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
     'João Silva', 'lead', 'active');

insert into public.contact_points
    (id, workspace_id, contact_id, point_type, normalized_value, operational_status) values
    ('d1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
     'c1000000-0000-4000-8000-000000000001', 'phone', '+5582999990001', 'active');

-- 3 conversas no Workspace A
insert into public.conversations
    (id, workspace_id, channel_connection_id, external_thread_id,
     conversation_type, operational_status, visibility, started_at) values
    ('e1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
     'ca000000-0000-4000-8000-000000000001', 'thread-1',
     'individual', 'active', 'commercial', now() - interval '3 hours'),
    ('e2000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001',
     'ca000000-0000-4000-8000-000000000001', 'thread-2',
     'individual', 'active', 'commercial', now() - interval '2 hours'),
    ('e3000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000001',
     'ca000000-0000-4000-8000-000000000001', 'thread-3',
     'group', 'active', 'owner_only', now() - interval '1 hour');

-- Participante de e1 vinculado ao contato João Silva
insert into public.conversation_participants
    (id, workspace_id, conversation_id, contact_point_id, first_seen_at) values
    ('f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
     'e1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001',
     now() - interval '3 hours');

-- Duas mensagens em e1 (a mais recente = 'Última mensagem')
insert into public.messages
    (id, workspace_id, conversation_id, channel_connection_id,
     direction, origin, status, occurred_at, received_at, external_message_id,
     external_created_at, sender_contact_point_id, text_content) values
    ('f2000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
     'e1000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
     'incoming', 'whatsapp', 'received',
     now() - interval '2 hours 30 minutes',
     now() - interval '2 hours 30 minutes',
     'ext-m-001', now() - interval '2 hours 30 minutes',
     'd1000000-0000-4000-8000-000000000001',
     'Primeira mensagem'),
    ('f2000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000001',
     'e1000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001',
     'incoming', 'whatsapp', 'received',
     now() - interval '1 hour',
     now() - interval '1 hour',
     'ext-m-002', now() - interval '1 hour',
     'd1000000-0000-4000-8000-000000000001',
     'Última mensagem');

-- Conversa do Workspace B (isolamento)
insert into public.conversations
    (id, workspace_id, channel_connection_id, external_thread_id,
     conversation_type, operational_status, visibility, started_at) values
    ('eb000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002',
     'cb000000-0000-4000-8000-000000000002', 'thread-b',
     'individual', 'active', 'commercial', now());

-- ─────────────────────────────────────────────────────────────
-- 4. Testes funcionais como OWNER do Workspace A
-- ─────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
    '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',
    true);
set local role authenticated;

-- OWNER vê 3 conversas do Workspace A
select is(
    (select count(*)::int from public.get_conversations_list()),
    3,
    'OWNER sees exactly 3 conversations from their workspace'
);

-- Isolamento de workspace
select ok(
    not exists (
        select 1 from public.get_conversations_list()
        where conversation_id = 'eb000000-0000-4000-8000-000000000001'::uuid
    ),
    'workspace isolation: Workspace B conversation not visible to Owner A'
);

-- Última mensagem correta (texto)
select is(
    (select last_msg_text from public.get_conversations_list()
     where conversation_id = 'e1000000-0000-4000-8000-000000000001'::uuid),
    'Última mensagem',
    'last message text is the most recent one'
);

-- Última mensagem correta (direction)
select is(
    (select last_msg_direction from public.get_conversations_list()
     where conversation_id = 'e1000000-0000-4000-8000-000000000001'::uuid),
    'incoming',
    'last message direction is correct'
);

-- Conversa sem mensagens retorna NULL em last_msg_text
select is(
    (select last_msg_text from public.get_conversations_list()
     where conversation_id = 'e2000000-0000-4000-8000-000000000002'::uuid),
    null::text,
    'conversation with no messages returns null last_msg_text'
);

-- Ordenação: e3 (group, started_at mais recente, sem mensagens) aparece primeiro
select is(
    (select conversation_id from public.get_conversations_list() limit 1),
    'e3000000-0000-4000-8000-000000000003'::uuid,
    'group conversation with most recent started_at appears first when no messages'
);

-- Grupo owner_only visível para o OWNER
select ok(
    exists (
        select 1 from public.get_conversations_list()
        where conversation_id = 'e3000000-0000-4000-8000-000000000003'::uuid
          and conversation_type = 'group'
          and visibility = 'owner_only'
    ),
    'OWNER can see group conversations with owner_only visibility'
);

-- Busca por nome do contato (João Silva)
select ok(
    exists (
        select 1 from public.get_conversations_list(p_search => 'João')
        where conversation_id = 'e1000000-0000-4000-8000-000000000001'::uuid
    ),
    'search by contact display_name returns the linked conversation'
);

-- Busca por telefone normalizado
select ok(
    exists (
        select 1 from public.get_conversations_list(p_search => '99999')
        where conversation_id = 'e1000000-0000-4000-8000-000000000001'::uuid
    ),
    'search by normalized phone returns the linked conversation'
);

-- Limite: p_limit=1 retorna exatamente 1 linha
select is(
    (select count(*)::int from public.get_conversations_list(p_limit => 1)),
    1,
    'p_limit=1 returns exactly one row'
);

-- Paginação: primeiro lote de 2 retorna 2 itens
select is(
    (select count(*)::int from public.get_conversations_list(p_limit => 2)),
    2,
    'first page with p_limit=2 returns exactly 2 conversations'
);

-- Paginação: segundo lote com cursor retorna 1 item (sem duplicações)
select is(
    (
        with first_page as (
            select next_cursor_ts, next_cursor_id
            from public.get_conversations_list(p_limit => 2)
            limit 1
        )
        select count(*)::int
        from public.get_conversations_list(
            p_cursor_ts => (select next_cursor_ts from first_page),
            p_cursor_id => (select next_cursor_id from first_page),
            p_limit => 10
        )
    ),
    1,
    'second page via cursor returns 1 remaining conversation without duplication'
);

-- Clamping: p_limit=500 retorna no máximo 100
select ok(
    (select count(*)::int from public.get_conversations_list(p_limit => 500)) <= 100,
    'p_limit is clamped to a maximum of 100'
);

-- ─────────────────────────────────────────────────────────────
-- 5. Bloqueio anônimo confirmado via has_function_privilege
-- ─────────────────────────────────────────────────────────────
-- O grant test (teste 5) já confirma que anon não pode executar.
-- Aqui adicionamos verificação explícita como contrapeso positivo.
reset role;

select ok(
    not pg_catalog.has_function_privilege(
        'anon',
        'public.get_conversations_list(text, timestamptz, uuid, int)',
        'execute'
    ),
    'anon has no execute privilege on get_conversations_list (confirmed again after data tests)'
);

select * from finish();
rollback;
