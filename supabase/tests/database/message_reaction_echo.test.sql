begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(6);

insert into auth.users (id, email) values ('b6200000-0000-4000-8000-000000000001', 're-owner@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values ('b6200001-0000-4000-8000-000000000001', 'b6200000-0000-4000-8000-000000000001', 'RE Owner', 'active');
insert into public.workspaces (id, name, status, timezone)
values ('b6200002-0000-4000-8000-000000000001', 'RE Workspace', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values ('b6200003-0000-4000-8000-000000000001', 'b6200002-0000-4000-8000-000000000001', 'b6200001-0000-4000-8000-000000000001', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b6200004-0000-4000-8000-000000000001', 'b6200002-0000-4000-8000-000000000001', 'whatsapp', 're_instance', '+5582999906200', 'active', now(), true);

select public.ingest_whatsapp_text_message('re_instance', 're-1', '5582988886201@s.whatsapp.net', false, 'Cliente Eco', 'Oi', now() - interval '1 hour');
select public.ingest_whatsapp_text_message('re_instance', 're-2', '5582988886201@s.whatsapp.net', false, 'Cliente Eco', 'Tudo bem?', now() - interval '50 minutes');

create temp table re_msg on commit drop as select id, external_message_id from public.messages where external_message_id in ('re-1', 're-2');
grant select on re_msg to service_role;

set local role service_role;
-- um membro reage pelo ImobFlux; a Evolution devolve o eco "enviada por mim"
select public.commit_message_reaction((select id from re_msg where external_message_id = 're-1'), 'b6200003-0000-4000-8000-000000000001', '👍');
select is(
    (public.ingest_whatsapp_reaction('re_instance', 're-1', '5582988886201@s.whatsapp.net', true, '👍')->>'reason'),
    'echo',
    'o eco da reação enviada pelo ImobFlux é ignorado'
);
reset role;
select is(
    (select count(*)::int from public.message_reactions where message_id = (select id from re_msg where external_message_id = 're-1')),
    1,
    'continua uma reação só'
);

set local role service_role;
-- reação com emoji diferente feita no celular da conta: entra normalmente
select is(
    (public.ingest_whatsapp_reaction('re_instance', 're-1', '5582988886201@s.whatsapp.net', true, '🙏')->>'status'),
    'success',
    'emoji diferente feito no celular da conta entra'
);
-- reação no celular em outra mensagem, sem membro: entra
select is(
    (public.ingest_whatsapp_reaction('re_instance', 're-2', '5582988886201@s.whatsapp.net', true, '👍')->>'status'),
    'success',
    'reação do celular numa mensagem sem reação de membro entra'
);
reset role;

-- a reação do membro é antiga (mais de 2 minutos): um "eco" tardio já é reação do celular
set local session_replication_role = replica; -- o gatilho de updated_at não pode refazer a data antiga
update public.message_reactions set updated_at = now() - interval '10 minutes' where member_id is not null;
set local session_replication_role = origin;
set local role service_role;
select is(
    (public.ingest_whatsapp_reaction('re_instance', 're-1', '5582988886201@s.whatsapp.net', true, '👍')->>'status'),
    'success',
    'emoji novo vindo do celular substitui a reação anterior da conta (sem janela de tempo)'
);
reset role;
select is(
    (select count(*)::int from public.message_reactions where message_id = (select id from re_msg where external_message_id = 're-1')),
    1,
    'a conta tem uma reação só (a nova substituiu a anterior)'
);

select * from finish();
rollback;
