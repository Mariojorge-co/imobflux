begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(21);

-- Reação de CLIENTE: o reator é achado pelo contato da conversa individual, ou pelo telefone com e sem o nono dígito.
-- Números fictícios. "12 dígitos" = sem o nono dígito (como o WhatsApp manda o JID); "13 dígitos" = com o 9.

insert into auth.users (id, email)
values ('b6900000-0000-4000-8000-000000000001', 'rc-owner@example.test'), ('b6900000-0000-4000-8000-000000000002', 'rc-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values ('b6900001-0000-4000-8000-000000000001', 'b6900000-0000-4000-8000-000000000001', 'RC Owner', 'active'),
       ('b6900001-0000-4000-8000-000000000002', 'b6900000-0000-4000-8000-000000000002', 'RC Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b6900002-0000-4000-8000-000000000001', 'RC Workspace A', 'active', 'America/Maceio'),
       ('b6900002-0000-4000-8000-000000000002', 'RC Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values ('b6900003-0000-4000-8000-000000000001', 'b6900002-0000-4000-8000-000000000001', 'b6900001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
       ('b6900003-0000-4000-8000-000000000002', 'b6900002-0000-4000-8000-000000000002', 'b6900001-0000-4000-8000-000000000002', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b6900004-0000-4000-8000-000000000001', 'b6900002-0000-4000-8000-000000000001', 'whatsapp', 'rc_instance', '+5582999906900', 'active', now(), true),
       ('b6900004-0000-4000-8000-000000000002', 'b6900002-0000-4000-8000-000000000002', 'whatsapp', 'rc_instance_b', '+5582999906901', 'active', now(), true);

-- c1: conversa com JID de 12 dígitos; o contato é depois cadastrado com 13 (caso real de produção)
select public.ingest_whatsapp_text_message('rc_instance', 'rc-1', '558288886911@s.whatsapp.net', false, 'Cliente Um', 'Oi', now() - interval '60 minutes');
update public.contact_points set normalized_value = '+5582988886911' where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+558288886911';
-- c2: contato com 12 dígitos; o participante some para forçar o caminho do telefone (b)
select public.ingest_whatsapp_text_message('rc_instance', 'rc-2', '558288886912@s.whatsapp.net', false, 'Cliente Dois', 'Oi', now() - interval '59 minutes');
-- c3: contato com 13 dígitos; o participante some para forçar o caminho do telefone (b)
select public.ingest_whatsapp_text_message('rc_instance', 'rc-3', '558288886913@s.whatsapp.net', false, 'Cliente Tres', 'Oi', now() - interval '58 minutes');
update public.contact_points set normalized_value = '+5582988886913' where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+558288886913';
-- c4: outra conversa individual (reator de OUTRA conversa não pode se misturar)
select public.ingest_whatsapp_text_message('rc_instance', 'rc-4', '5582988886914@s.whatsapp.net', false, 'Cliente Quatro', 'Oi', now() - interval '57 minutes');
-- c5a (13 dígitos, mais antigo) e c5b (12 dígitos, mais novo): o mesmo telefone cadastrado duas vezes; c5c: conversa sem participante
select public.ingest_whatsapp_text_message('rc_instance', 'rc-5a', '5582988886915@s.whatsapp.net', false, 'Cliente Cinco A', 'Oi', now() - interval '56 minutes');
select public.ingest_whatsapp_text_message('rc_instance', 'rc-5b', '558288886915@s.whatsapp.net', false, 'Cliente Cinco B', 'Oi', now() - interval '55 minutes');
select public.ingest_whatsapp_text_message('rc_instance', 'rc-5c', '5582988886916@s.whatsapp.net', false, 'Cliente Cinco C', 'Oi', now() - interval '54 minutes');
update public.contact_points set created_at = now() - interval '2 days' where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+5582988886915';
-- c6: mensagem em grupo
select public.ingest_whatsapp_group_text_message('rc_instance', 'rc-g', '120363006900000001@g.us', '5582988886917@s.whatsapp.net', false, 'Grupo RC', 'Membro', 'oi pessoal', now() - interval '53 minutes');
-- c7: mensagem apagada
select public.ingest_whatsapp_text_message('rc_instance', 'rc-7', '5582988886918@s.whatsapp.net', false, 'Cliente Sete', 'Oi', now() - interval '52 minutes');
-- Workspace B
select public.ingest_whatsapp_text_message('rc_instance_b', 'rc-b', '5582988886919@s.whatsapp.net', false, 'Cliente B', 'Oi', now() - interval '51 minutes');

delete from public.conversation_participants where conversation_id in (
    select m.conversation_id from public.messages m where m.external_message_id in ('rc-2', 'rc-3', 'rc-5c'));
select private.apply_message_deletion((select id from public.messages where external_message_id = 'rc-7'), null, 'whatsapp');

create temp table rc_ids on commit drop as
select
    (select id from public.contact_points where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+5582988886911') as p1,
    (select id from public.contact_points where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+558288886912') as p2,
    (select id from public.contact_points where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+5582988886913') as p3,
    (select id from public.contact_points where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+5582988886914') as p4,
    (select id from public.contact_points where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+5582988886915') as p5_13,
    (select id from public.contact_points where workspace_id = 'b6900002-0000-4000-8000-000000000001' and normalized_value = '+558288886915') as p5_12;
create temp table rc_msg on commit drop as select id, external_message_id as ext from public.messages;
grant select on rc_ids, rc_msg to service_role;
grant select on public.message_reactions to service_role;

set local role service_role;

-- 1) JID da conversa com 12 dígitos e contato cadastrado com 13: a reação entra, ligada ao contato da conversa
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-1', '558288886911@s.whatsapp.net', false, '👍')->>'status', 'success', 'cliente: JID de 12 dígitos e contato de 13 dígitos');
select is((select contact_point_id from public.message_reactions where message_id = (select id from rc_msg where ext = 'rc-1')), (select p1 from rc_ids), 'a reação ficou no contato da conversa');
-- trocar o emoji substitui (uma reação por contato)
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-1', '558288886911@s.whatsapp.net', false, '❤️')->>'status', 'success', 'cliente troca o emoji');
select is((select string_agg(emoji, ',') from public.message_reactions where message_id = (select id from rc_msg where ext = 'rc-1')), '❤️', 'continua uma reação por contato, com o emoji novo');
-- remover (texto vazio)
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-1', '558288886911@s.whatsapp.net', false, '')->>'status', 'removed', 'cliente remove a reação (texto vazio)');
select is((select count(*)::int from public.message_reactions where message_id = (select id from rc_msg where ext = 'rc-1')), 0, 'removida: não sobra reação');

-- 2) o inverso, pelo telefone: contato de 12 dígitos e reator com 13
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-2', '5582988886912@s.whatsapp.net', false, '👍')->>'status', 'success', 'inverso: contato de 12 dígitos e reator com 13');
select is((select contact_point_id from public.message_reactions where message_id = (select id from rc_msg where ext = 'rc-2')), (select p2 from rc_ids), 'ligada ao contato de 12 dígitos');
-- e pelo telefone: contato de 13 e reator com 12
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-3', '558288886913@s.whatsapp.net', false, '👍')->>'status', 'success', 'pelo telefone: contato de 13 e reator com 12');
select is((select contact_point_id from public.message_reactions where message_id = (select id from rc_msg where ext = 'rc-3')), (select p3 from rc_ids), 'ligada ao contato de 13 dígitos');

-- 3) @lid sem telefone em conversa individual: vale o contato da conversa
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-4', '218943875198110@lid', false, '🙏')->>'status', 'success', '@lid sem telefone em conversa individual');
select is((select contact_point_id from public.message_reactions where message_id = (select id from rc_msg where ext = 'rc-4')), (select p4 from rc_ids), 'ligada ao contato daquela conversa');

-- 4) reator de OUTRA conversa não se mistura: o telefone do contato da conversa 4 reagindo numa mensagem da conversa 1
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-1', '5582988886914@s.whatsapp.net', false, '😂')->>'status', 'success', 'reação numa conversa é sempre do contato dela');
select is((select count(*)::int from public.message_reactions where contact_point_id = (select p4 from rc_ids) and message_id = (select id from rc_msg where ext = 'rc-1')), 0, 'o contato de outra conversa não ganha a reação');

-- 5) contato duplicado com o mesmo telefone (12 e 13 dígitos): vale o mais antigo
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-5c', '558288886915@s.whatsapp.net', false, '👍')->>'status', 'success', 'telefone com dois contatos (12 e 13 dígitos)');
select is((select contact_point_id from public.message_reactions where message_id = (select id from rc_msg where ext = 'rc-5c')), (select p5_13 from rc_ids), 'vale o contato mais antigo');

-- 6) outro workspace: o id da mensagem de B não é achado pela conexão de A
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-b', '5582988886919@s.whatsapp.net', false, '👍')->>'reason', 'unknown_message', 'reação em conversa de outro workspace é ignorada');

-- 7) grupo: o telefone do reator desconhecido continua ignorado; o participante do grupo não é usado como atalho
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-g', '5582977770099@s.whatsapp.net', false, '👍')->>'reason', 'unknown_reactor', 'grupo: reator desconhecido segue ignorado');

-- 8) mensagem apagada segue ignorada
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-7', '5582988886918@s.whatsapp.net', false, '👍')->>'reason', 'deleted', 'mensagem apagada segue ignorada');

reset role;
-- 9) a reação da conta (celular) não mudou: entra, e o mesmo emoji vindo de novo é eco
set local role service_role;
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-1', '', true, '👍')->>'status', 'success', 'reação do celular da conta segue entrando');
select is(public.ingest_whatsapp_reaction('rc_instance', 'rc-1', '', true, '👍')->>'reason', 'echo', 'o mesmo emoji do celular é eco');
reset role;

select * from finish();
rollback;
