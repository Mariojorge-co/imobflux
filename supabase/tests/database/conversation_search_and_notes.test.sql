begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(24);

insert into auth.users (id, email)
values
    ('b6100000-0000-4000-8000-000000000001', 'sn-owner@example.test'),
    ('b6100000-0000-4000-8000-000000000002', 'sn-att1@example.test'),
    ('b6100000-0000-4000-8000-000000000003', 'sn-att2@example.test'),
    ('b6100000-0000-4000-8000-000000000004', 'sn-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b6100001-0000-4000-8000-000000000001', 'b6100000-0000-4000-8000-000000000001', 'SN Owner', 'active'),
    ('b6100001-0000-4000-8000-000000000002', 'b6100000-0000-4000-8000-000000000002', 'SN Att1', 'active'),
    ('b6100001-0000-4000-8000-000000000003', 'b6100000-0000-4000-8000-000000000003', 'SN Att2', 'active'),
    ('b6100001-0000-4000-8000-000000000004', 'b6100000-0000-4000-8000-000000000004', 'SN Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b6100002-0000-4000-8000-000000000001', 'SN Workspace A', 'active', 'America/Maceio'),
    ('b6100002-0000-4000-8000-000000000002', 'SN Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b6100003-0000-4000-8000-000000000001', 'b6100002-0000-4000-8000-000000000001', 'b6100001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b6100003-0000-4000-8000-000000000002', 'b6100002-0000-4000-8000-000000000001', 'b6100001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b6100003-0000-4000-8000-000000000001'),
    ('b6100003-0000-4000-8000-000000000003', 'b6100002-0000-4000-8000-000000000001', 'b6100001-0000-4000-8000-000000000003', 'attendant', 'active', now(), 'b6100003-0000-4000-8000-000000000001'),
    ('b6100003-0000-4000-8000-000000000004', 'b6100002-0000-4000-8000-000000000002', 'b6100001-0000-4000-8000-000000000004', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b6100004-0000-4000-8000-000000000001', 'b6100002-0000-4000-8000-000000000001', 'whatsapp', 'sn_instance', '+5582999906100', 'active', now(), true);

select public.ingest_whatsapp_text_message('sn_instance', 'sn-1', '5582988886101@s.whatsapp.net', false, 'Cliente Busca', 'Quero o apartamento da Ponta Verde', now() - interval '5 hours');
select public.ingest_whatsapp_text_message('sn_instance', 'sn-2', '5582988886101@s.whatsapp.net', false, 'Cliente Busca', 'Qual o valor de 100% do imóvel?', now() - interval '4 hours');
select public.ingest_whatsapp_text_message('sn_instance', 'sn-3', '5582988886101@s.whatsapp.net', false, 'Cliente Busca', 'PONTA VERDE é ótimo', now() - interval '3 hours');
select public.ingest_whatsapp_text_message('sn_instance', 'sn-4', '5582988886101@s.whatsapp.net', false, 'Cliente Busca', 'sublinhado a_b e barra \ aqui', now() - interval '2 hours');
select public.ingest_whatsapp_text_message('sn_instance', 'sn-5', '5582988886101@s.whatsapp.net', false, 'Cliente Busca', 'Ponta Verde escondida', now() - interval '1 hour');
select public.ingest_whatsapp_text_message('sn_instance', 'sn-6', '5582988886101@s.whatsapp.net', false, 'Cliente Busca', 'Ponta Verde apagada', now() - interval '30 minutes');
select public.ingest_whatsapp_text_message('sn_instance', 'sn-o1', '5582988886102@s.whatsapp.net', false, 'Outro Cliente', 'Ponta Verde na outra conversa', now() - interval '3 hours');
select public.ingest_whatsapp_text_message('sn_instance', 'sn-prot', '5582988886103@s.whatsapp.net', false, 'Protegido', 'Ponta Verde protegido', now() - interval '3 hours');
update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988886103');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988886103';

create temp table sn_c on commit drop as
select
    (select id from public.conversations where external_thread_id = '5582988886101@s.whatsapp.net') as main,
    (select id from public.conversations where external_thread_id = '5582988886102@s.whatsapp.net') as other,
    (select id from public.conversations where external_thread_id = '5582988886103@s.whatsapp.net') as prot;
grant select on sn_c to authenticated;

update public.messages set hidden_at = now(), hidden_by_member_id = 'b6100003-0000-4000-8000-000000000001' where external_message_id = 'sn-5';
update public.messages set deleted_at = now(), deleted_source = 'crm' where external_message_id = 'sn-6';

-- ─── Busca ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b6100000-0000-4000-8000-000000000002';

select is(
    (public.search_conversation_messages((select main from sn_c), 'ponta verde', 50)->>'total')::int,
    2,
    'acha sem diferenciar maiúsculas e ignora escondida e apagada'
);
select is(
    (select m->>'snippet' from jsonb_array_elements(public.search_conversation_messages((select main from sn_c), 'ponta verde', 50)->'matches') m limit 1),
    'PONTA VERDE é ótimo',
    'vem do mais novo para o mais antigo'
);
select is(
    (public.search_conversation_messages((select main from sn_c), 'Ponta Verde', 50)->>'total')::int,
    2,
    'não traz mensagens de outras conversas'
);
select is(
    (public.search_conversation_messages((select main from sn_c), '100%', 50)->>'total')::int,
    1,
    '% do termo é literal (não é curinga)'
);
select is(
    (public.search_conversation_messages((select main from sn_c), 'a_b', 50)->>'total')::int,
    1,
    '_ do termo é literal'
);
select is(
    (public.search_conversation_messages((select main from sn_c), 'a_c', 50)->>'total')::int,
    0,
    '_ não casa qualquer caractere'
);
select is(
    (public.search_conversation_messages((select main from sn_c), '\ aqui', 50)->>'total')::int,
    1,
    'barra invertida é literal'
);
select is(
    (public.search_conversation_messages((select main from sn_c), 'p', 50)->>'total')::int,
    0,
    'termo de 1 caractere não busca'
);
select is(
    (public.search_conversation_messages((select main from sn_c), '   ', 50)->>'total')::int,
    0,
    'termo em branco não busca'
);
select is(
    (jsonb_array_length(public.search_conversation_messages((select main from sn_c), 'ponta verde', 1)->'matches')),
    1,
    'o limite corta a lista, e o total continua o real'
);
select is(
    (public.search_conversation_messages((select main from sn_c), 'ponta verde', 1)->>'total')::int,
    2,
    'total real mesmo com limite'
);
select is(
    (public.search_conversation_messages((select prot from sn_c), 'ponta verde', 50)->>'total')::int,
    0,
    'conversa protegida: o atendente não acha nada (RLS)'
);

-- ─── Notas: criar, listar, buscar ────────────────────────────────────────────────────────────────
select lives_ok(
    $$select public.save_internal_note((select main from sn_c), 'Cliente prefere visita no sábado', null)$$,
    'atendente 1 cria nota'
);
create temp table sn_note on commit drop as
select id from public.internal_notes where content = 'Cliente prefere visita no sábado';
grant select on sn_note to authenticated;

select is(
    (public.search_conversation_messages((select main from sn_c), 'sábado', 50)->'matches'->0->>'kind'),
    'note',
    'a busca inclui notas internas'
);
select is(
    (select count(*)::int from public.list_conversation_notes((select main from sn_c))),
    1,
    'lista as notas da conversa'
);

-- ─── Notas: editar e apagar ──────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b6100000-0000-4000-8000-000000000003';
select throws_ok(
    $$select public.update_internal_note((select id from sn_note), 'Editada por outro')$$,
    '42501', 'note_not_authorized',
    'outro atendente não edita a nota alheia'
);
select throws_ok(
    $$select public.archive_internal_note((select id from sn_note))$$,
    '42501', 'note_not_authorized',
    'outro atendente não apaga a nota alheia'
);

set local "request.jwt.claim.sub" = 'b6100000-0000-4000-8000-000000000002';
select is(
    (public.update_internal_note((select id from sn_note), 'Cliente prefere visita no domingo')->>'status'),
    'success',
    'o autor edita a própria nota'
);
select is(
    (public.update_internal_note((select id from sn_note), 'Cliente prefere visita no domingo')->>'status'),
    'unchanged',
    'texto igual não muda'
);
select throws_ok(
    $$select public.update_internal_note((select id from sn_note), '   ')$$,
    '22023', 'internal_note_content_empty',
    'nota vazia é recusada'
);

set local "request.jwt.claim.sub" = 'b6100000-0000-4000-8000-000000000001';
select is(
    (public.archive_internal_note((select id from sn_note))->>'status'),
    'success',
    'o dono apaga qualquer nota'
);
select is(
    (public.search_conversation_messages((select main from sn_c), 'domingo', 50)->>'total')::int,
    0,
    'nota apagada sai da busca'
);

reset role;
select is(
    (select count(*)::int from public.audit_events where action in ('conversation.note_edited', 'conversation.note_deleted')),
    2,
    'editar e apagar nota ficam auditados'
);
select is(
    (select count(*)::int from public.messages where conversation_id = (select main from sn_c) and text_content ilike '%domingo%'),
    0,
    'a nota nunca vira mensagem (não vai ao WhatsApp)'
);

select * from finish();
rollback;
