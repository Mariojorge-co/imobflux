begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(8);

-- ─── Fixtures: workspace com OWNER, conexão ativa e uma etapa ───────────────────────
insert into auth.users (id, email)
values ('b4100000-0000-4000-8000-000000000001', 'ksla-owner@example.test');

insert into public.app_users (id, auth_user_id, display_name, status)
values ('b4100001-0000-4000-8000-000000000001', 'b4100000-0000-4000-8000-000000000001', 'KSLA Owner', 'active');

insert into public.workspaces (id, name, status, timezone)
values ('b4100002-0000-4000-8000-000000000001', 'KSLA Workspace', 'active', 'America/Maceio');

insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at)
values ('b4100003-0000-4000-8000-000000000001', 'b4100002-0000-4000-8000-000000000001', 'b4100001-0000-4000-8000-000000000001', 'owner', 'active', now());

insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('b4100004-0000-4000-8000-000000000001', 'b4100002-0000-4000-8000-000000000001', 'whatsapp', 'ksla_instance', '+5582999904100', 'active', now());

insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values ('b4100005-0000-4000-8000-000000000001', 'b4100002-0000-4000-8000-000000000001', 'Contato KSLA', 1, true, 'prospecting');

-- Cliente escreve (mensagem recebida); a conversa e o contato nascem da ingestão
select public.ingest_whatsapp_text_message(
    'ksla_instance', 'ksla-in-1', '5582988884100@s.whatsapp.net', false, 'Cliente KSLA',
    'Oi, quero saber do apartamento', now() + interval '1 minute'
);

insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status)
select 'b4100006-0000-4000-8000-000000000001', c.workspace_id, p.contact_id, 'b4100005-0000-4000-8000-000000000001', 'Apto KSLA', 'open'
from public.conversations c
join public.conversation_participants cp on cp.conversation_id = c.id
join public.contact_points p on p.id = cp.contact_point_id
where c.workspace_id = 'b4100002-0000-4000-8000-000000000001'
limit 1;

insert into public.opportunity_conversations (id, workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
select 'b4100007-0000-4000-8000-000000000001', c.workspace_id, 'b4100006-0000-4000-8000-000000000001', c.id,
       'b4100003-0000-4000-8000-000000000001', now()
from public.conversations c
where c.workspace_id = 'b4100002-0000-4000-8000-000000000001'
limit 1;

-- Oportunidade sem conversa: o card não deve ter dados de SLA
insert into public.contacts (id, workspace_id, display_name, classification, operational_status, is_protected)
values ('b4100008-0000-4000-8000-000000000001', 'b4100002-0000-4000-8000-000000000001', 'Sem Conversa', 'lead', 'active', false);
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status)
values ('b4100006-0000-4000-8000-000000000002', 'b4100002-0000-4000-8000-000000000001', 'b4100008-0000-4000-8000-000000000001', 'b4100005-0000-4000-8000-000000000001', 'Sem conversa KSLA', 'open');

set local role authenticated;
set local "request.jwt.claim.sub" = 'b4100000-0000-4000-8000-000000000001';

create temp table ksla_cards on commit drop as
select c as card
from jsonb_array_elements(public.get_kanban_board(50)) as stage,
     jsonb_array_elements(stage->'cards') as c;
grant select on ksla_cards to authenticated;

select is(
    (select count(*) from ksla_cards),
    2::bigint,
    'o quadro continua trazendo as duas oportunidades'
);

select is(
    (select card->>'last_msg_direction' from ksla_cards where card->>'title' = 'Apto KSLA'),
    'incoming',
    'card com conversa vinculada traz a direção da última mensagem (cliente aguardando)'
);

select ok(
    (select (card->>'last_msg_at')::timestamptz is not null from ksla_cards where card->>'title' = 'Apto KSLA'),
    'card com conversa vinculada traz a hora da última mensagem'
);

select is(
    (select card->>'has_linked_conversation' from ksla_cards where card->>'title' = 'Apto KSLA'),
    'true',
    'a conversa vinculada continua indicada'
);

select ok(
    (select card->'last_msg_direction' = 'null'::jsonb and card->'last_msg_at' = 'null'::jsonb
       from ksla_cards where card->>'title' = 'Sem conversa KSLA'),
    'card sem conversa vinculada fica sem dados de SLA'
);

-- Resposta da equipe vira a última mensagem: a direção muda para outgoing
reset role;
insert into public.messages (workspace_id, channel_connection_id, conversation_id, direction, origin, status, text_content, occurred_at, external_message_id, external_created_at, received_at)
select c.workspace_id, 'b4100004-0000-4000-8000-000000000001'::uuid, c.id, 'outgoing', 'whatsapp', 'sent', 'Claro! Posso te ligar?', now() + interval '5 minutes', 'ksla-out-1', now() + interval '5 minutes', now() + interval '5 minutes'
from public.conversations c
where c.workspace_id = 'b4100002-0000-4000-8000-000000000001'
limit 1;

set local role authenticated;
set local "request.jwt.claim.sub" = 'b4100000-0000-4000-8000-000000000001';

select is(
    (select c->>'last_msg_direction'
       from jsonb_array_elements(public.get_kanban_board(50)) as stage,
            jsonb_array_elements(stage->'cards') as c
      where c->>'title' = 'Apto KSLA'),
    'outgoing',
    'depois da resposta da equipe, a última mensagem do card passa a ser outgoing'
);

-- Permissões inalteradas
select ok(
    pg_catalog.has_function_privilege('authenticated', 'public.get_kanban_board(integer)', 'execute'),
    'authenticated continua executando get_kanban_board'
);
select ok(
    not pg_catalog.has_function_privilege('anon', 'public.get_kanban_board(integer)', 'execute'),
    'anon continua sem acesso a get_kanban_board'
);

select * from finish();
rollback;
