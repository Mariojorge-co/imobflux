begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(14);

-- Regressão: a hora da mensagem do WhatsApp quase sempre é ANTERIOR à chegada ao banco.
-- Antes da migration 38, a primeira mensagem de qualquer número novo violava
-- ck_contacts_timestamps (commercial_visible_from >= created_at) e o webhook respondia 500.

insert into auth.users (id, email)
values
    ('c3800000-0000-4000-8000-000000000001', 'timing-owner@example.test'),
    ('c3800000-0000-4000-8000-000000000002', 'timing-attendant@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('c3800001-0000-4000-8000-000000000001', 'c3800000-0000-4000-8000-000000000001', 'Timing Owner', 'active'),
    ('c3800001-0000-4000-8000-000000000002', 'c3800000-0000-4000-8000-000000000002', 'Timing Attendant', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('c3800002-0000-4000-8000-000000000001', 'Timing Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('c3800003-0000-4000-8000-000000000001', 'c3800002-0000-4000-8000-000000000001', 'c3800001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('c3800003-0000-4000-8000-000000000002', 'c3800002-0000-4000-8000-000000000001', 'c3800001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'c3800003-0000-4000-8000-000000000001');
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at)
values ('c3800004-0000-4000-8000-000000000001', 'c3800002-0000-4000-8000-000000000001', 'whatsapp', 'timing_instance', '+5582999903800', 'active', now());

-- WhatsApp pessoal (migration 005000): grupos vêm desligados por padrão; este teste exercita a ingestão de grupos.
update public.channel_connections set ingest_groups = true;

-- 1. Número novo, mensagem 30 s no passado (o caso real do webhook)
select lives_ok(
    $$select public.ingest_whatsapp_text_message('timing_instance', 'timing-new-1', '5582988883800@s.whatsapp.net', false, 'Cliente Novo', 'Primeira mensagem', now() - interval '30 seconds')$$,
    'first message from a brand-new number is ingested when it is older than the arrival time'
);
select is(
    (select count(*) from public.messages where external_message_id = 'timing-new-1'),
    1::bigint,
    'the message was stored'
);
select ok(
    (select contact.commercial_visible_from <= message.occurred_at and contact.commercial_visible_from >= contact.created_at and contact.updated_at >= contact.created_at
     from public.messages message
     join public.contact_points point on point.id = message.sender_contact_point_id
     join public.contacts contact on contact.id = point.contact_id
     where message.external_message_id = 'timing-new-1'),
    'contact is born at the message time: visible epoch precedes the message and respects created_at'
);

-- 2. Mensagem com horário ligeiramente à frente do relógio do banco (skew)
select lives_ok(
    $$select public.ingest_whatsapp_text_message('timing_instance', 'timing-future-1', '5582988883801@s.whatsapp.net', false, 'Cliente Futuro', 'Relógio adiantado', now() + interval '2 minutes')$$,
    'a message timestamp ahead of the database clock does not break ingestion'
);

-- 3. Remetente novo em grupo, mensagem no passado
select lives_ok(
    $$select public.ingest_whatsapp_group_text_message('timing_instance', 'timing-group-1', '120363003800000001@g.us', '5582988883802@s.whatsapp.net', false, 'Grupo Timing', 'Remetente Grupo', 'Olá grupo', now() - interval '30 seconds')$$,
    'new group sender and new group are ingested when the message is older than the arrival time'
);
select lives_ok(
    $$select public.ingest_whatsapp_group_text_message('timing_instance', 'timing-group-2', '120363003800000002@g.us', '5582988883803@s.whatsapp.net', false, 'Grupo Futuro', 'Remetente Futuro', 'Relógio adiantado', now() + interval '2 minutes')$$,
    'a future-dated group message does not break ingestion'
);

-- 4. Mensagem retroativa (histórico) para número que já existe como remetente de grupo (ponto sem contato)
select lives_ok(
    $$select public.ingest_whatsapp_text_message('timing_instance', 'timing-backfill-1', '5582988883802@s.whatsapp.net', false, 'Remetente Grupo', 'Mensagem antiga no privado', now() - interval '1 hour')$$,
    'a historical message for an existing contact point (created from a group) is ingested'
);
select ok(
    (select point.contact_id is not null and point.commercial_visible_from >= point.created_at
     from public.contact_points point where point.normalized_value = '+5582988883802'),
    'the existing contact point was linked with a visible epoch that respects created_at'
);

-- 5. Retroativa para número que já tem conversa
select lives_ok(
    $$select public.ingest_whatsapp_text_message('timing_instance', 'timing-backfill-2', '5582988883800@s.whatsapp.net', false, 'Cliente Novo', 'Outra mensagem antiga', now() - interval '2 hours')$$,
    'a historical message for an existing conversation is ingested'
);

-- 6. A equipe enxerga a primeira mensagem do número novo (a visibilidade começa antes dela)
set local role authenticated;
set local "request.jwt.claim.sub" = 'c3800000-0000-4000-8000-000000000002';

select is(
    (select count(*) from public.messages where external_message_id = 'timing-new-1'),
    1::bigint,
    'ATTENDANT sees the very first message of a new number'
);
select is(
    (select count(*) from public.conversations where conversation_type = 'individual'),
    3::bigint,
    'ATTENDANT sees the individual conversations created by ingestion'
);
select ok(
    (select (public.get_conversations_inbox()->'counts'->>'unread')::int >= 2),
    'new incoming messages count as unread for the team'
);

reset role;
select is(
    (select count(*) from public.contacts where registration_status = 'provisional'),
    3::bigint,
    'one provisional contact per new number'
);
select is(
    (select count(*) from public.conversations where conversation_type = 'group' and visibility = 'owner_only'),
    2::bigint,
    'groups created by ingestion remain OWNER-only'
);

select * from finish();
rollback;
