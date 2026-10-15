begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, auth, pg_catalog;

select plan(59);

-- ─── Fixtures: workspace A (owner, atendente, conexão com número próprio) e workspace B (owner) ────
insert into auth.users (id, email)
values
    ('b5500000-0000-4000-8000-000000000001', 'sl-owner-a@example.test'),
    ('b5500000-0000-4000-8000-000000000002', 'sl-att-a@example.test'),
    ('b5500000-0000-4000-8000-000000000003', 'sl-owner-b@example.test');
insert into public.app_users (id, auth_user_id, display_name, status)
values
    ('b5500001-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-000000000001', 'SL Owner A', 'active'),
    ('b5500001-0000-4000-8000-000000000002', 'b5500000-0000-4000-8000-000000000002', 'SL Att A', 'active'),
    ('b5500001-0000-4000-8000-000000000003', 'b5500000-0000-4000-8000-000000000003', 'SL Owner B', 'active');
insert into public.workspaces (id, name, status, timezone)
values
    ('b5500002-0000-4000-8000-000000000001', 'SL Workspace A', 'active', 'America/Maceio'),
    ('b5500002-0000-4000-8000-000000000002', 'SL Workspace B', 'active', 'America/Maceio');
insert into public.workspace_members (id, workspace_id, user_id, role, status, activated_at, invited_by_member_id)
values
    ('b5500003-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000001', 'b5500001-0000-4000-8000-000000000001', 'owner', 'active', now(), null),
    ('b5500003-0000-4000-8000-000000000002', 'b5500002-0000-4000-8000-000000000001', 'b5500001-0000-4000-8000-000000000002', 'attendant', 'active', now(), 'b5500003-0000-4000-8000-000000000001'),
    ('b5500003-0000-4000-8000-000000000003', 'b5500002-0000-4000-8000-000000000002', 'b5500001-0000-4000-8000-000000000003', 'owner', 'active', now(), null);
insert into public.channel_connections (id, workspace_id, provider, external_account_id, external_phone_normalized, status, activated_at, ingest_groups)
values ('b5500004-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000001', 'whatsapp', 'sl_instance', '+5582999905500', 'active', now(), true);
insert into public.pipeline_stages (id, workspace_id, name, position, is_active, commercial_meaning)
values ('b5500005-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000001', 'Contato SL', 1, true, 'prospecting');

-- A: cliente escreveu por último, há 30 min (equipe devendo)
select public.ingest_whatsapp_text_message('sl_instance', 'sl-a-1', '5582988885500@s.whatsapp.net', false, 'Cliente A', 'Oi, quero o apartamento', now() - interval '30 minutes');
-- B: nós escrevemos por último, há 7 h (aguardando cliente)
select public.ingest_whatsapp_text_message('sl_instance', 'sl-b-1', '5582988885501@s.whatsapp.net', false, 'Cliente B', 'Pode me ligar?', now() - interval '9 hours');
select public.ingest_whatsapp_text_message('sl_instance', 'sl-b-2', '5582988885501@s.whatsapp.net', true, '', 'Claro, ligo já', now() - interval '7 hours');
-- C: grupo
select public.ingest_whatsapp_group_text_message('sl_instance', 'sl-g-1', '120363005500000001@g.us', '5582988885502@s.whatsapp.net', false, 'Grupo SL', 'Membro', 'oi pessoal', now() - interval '20 minutes');
-- D: conversa consigo mesmo (número da própria conexão)
select public.ingest_whatsapp_text_message('sl_instance', 'sl-s-1', '5582999905500@s.whatsapp.net', true, '', 'nota para mim', now() - interval '40 minutes');
-- E: contato protegido (só o dono vê)
select public.ingest_whatsapp_text_message('sl_instance', 'sl-p-1', '5582988885503@s.whatsapp.net', false, 'Cliente Protegido', 'Oi', now() - interval '50 minutes');
update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988885503');
update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988885503';
-- F: encerrada (arquivada)
select public.ingest_whatsapp_text_message('sl_instance', 'sl-f-1', '5582988885504@s.whatsapp.net', false, 'Cliente F', 'Preciso de proposta', now() - interval '3 hours');
update public.conversations set operational_status = 'archived', archived_at = now() - interval '10 minutes' where external_thread_id = '5582988885504@s.whatsapp.net';

create temp table sl_ids on commit drop as
select
    (select id from public.conversations where external_thread_id = '5582988885500@s.whatsapp.net') as a,
    (select id from public.conversations where external_thread_id = '5582988885501@s.whatsapp.net') as b,
    (select id from public.conversations where external_thread_id = '120363005500000001@g.us') as grp,
    (select id from public.conversations where external_thread_id = '5582999905500@s.whatsapp.net') as self,
    (select id from public.conversations where external_thread_id = '5582988885503@s.whatsapp.net') as prot,
    (select id from public.conversations where external_thread_id = '5582988885504@s.whatsapp.net') as arch;
grant select on sl_ids to authenticated, service_role;

-- Oportunidade ligada à conversa A (para o Kanban)
insert into public.opportunities (id, workspace_id, contact_id, current_stage_id, title, status)
select 'b5500006-0000-4000-8000-000000000001', c.workspace_id, p.contact_id, 'b5500005-0000-4000-8000-000000000001', 'Opp SL', 'open'
from public.conversations c
join public.conversation_participants cp on cp.conversation_id = c.id
join public.contact_points p on p.id = cp.contact_point_id
where c.id = (select a from sl_ids);
insert into public.opportunity_conversations (id, workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at)
values ('b5500007-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000001', 'b5500006-0000-4000-8000-000000000001', (select a from sl_ids), 'b5500003-0000-4000-8000-000000000001', now());

-- ─── Forma e permissões ──────────────────────────────────────────────────────────────────────────
select ok(
    (select bool_and(
        pg_catalog.has_function_privilege('authenticated', f, 'execute')
        and not pg_catalog.has_function_privilege('anon', f, 'execute')
        and not pg_catalog.has_function_privilege('service_role', f, 'execute'))
     from unnest(array[
        'public.get_sla_settings()',
        'public.update_sla_settings(integer,integer,integer,integer,integer,integer,integer)',
        'public.set_conversation_sla_mode(uuid,text)',
        'public.get_sla_conversations(integer)',
        'private.sla_applies(uuid)',
        'private.is_self_conversation(uuid)']) as f),
    'funções de prazo: só usuário autenticado (nunca anon nem service_role)'
);
select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']::text[])
     from pg_catalog.pg_proc p
     where p.proname in ('get_sla_settings', 'update_sla_settings', 'set_conversation_sla_mode', 'sla_applies', 'is_self_conversation')
       and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)),
    'funções de prazo: SECURITY DEFINER com search_path vazio'
);
select ok(
    (select not p.prosecdef and p.proconfig = array['search_path=""']::text[] from pg_catalog.pg_proc p where p.oid = 'public.get_sla_conversations(integer)'::regprocedure),
    'get_sla_conversations roda como o chamador (RLS vale) e fixa search_path vazio'
);
select ok(
    (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.workspace_sla_settings'::regclass)
    and not pg_catalog.has_table_privilege('authenticated', 'public.workspace_sla_settings', 'insert')
    and not pg_catalog.has_table_privilege('authenticated', 'public.workspace_sla_settings', 'update')
    and not pg_catalog.has_table_privilege('anon', 'public.workspace_sla_settings', 'select')
    and not pg_catalog.has_table_privilege('service_role', 'public.workspace_sla_settings', 'select'),
    'tabela de limites: RLS ligada, escrita direta negada, anon e service_role sem leitura'
);

-- ─── Limites: padrões, quem altera, validações ───────────────────────────────────────────────────
select is((select count(*)::int from public.workspace_sla_settings), 0, 'a migration não insere limites');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000002';
select is(
    public.get_sla_settings() - 'is_default',
    '{"team_green_until_minutes": 10, "team_yellow_until_minutes": 15, "team_orange_until_minutes": 30, "team_red_until_minutes": 1440, "followup_level1_minutes": 360, "followup_level2_minutes": 1440, "followup_level3_minutes": 4320}'::jsonb,
    'padrões: Cliente aguardando 10/15/30 min e 24 h; follow-up 6 h, 24 h e 72 h'
);
select is((public.get_sla_settings()->>'is_default')::boolean, true, 'sem configuração aparece como padrão');
select throws_ok($$select public.update_sla_settings(10, 15, 30, 1440, 360, 1440, 4320)$$, '42501', 'sla_not_authorized', 'ATENDENTE não altera os limites');

set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000001';
select throws_ok($$select public.update_sla_settings(15, 10, 30, 1440, 360, 1440, 4320)$$, '22023', 'sla_limits_invalid', 'níveis de equipe fora de ordem são recusados');
select throws_ok($$select public.update_sla_settings(10, 15, 30, 1440, 1440, 360, 4320)$$, '22023', 'sla_limits_invalid', 'níveis de follow-up fora de ordem são recusados');
select throws_ok($$select public.update_sla_settings(10, 15, 30, 43201, 360, 1440, 4320)$$, '22023', 'sla_limits_invalid', 'acima de 30 dias é recusado');
select throws_ok($$select public.update_sla_settings(0, 15, 30, 1440, 360, 1440, 4320)$$, '22023', 'sla_limits_invalid', 'zero minutos é recusado');
select throws_ok($$select public.update_sla_settings(10, 10, 30, 1440, 360, 1440, 4320)$$, '22023', 'sla_limits_invalid', 'níveis iguais são recusados');
select throws_ok($$select public.update_sla_settings(null, 15, 30, 1440, 360, 1440, 4320)$$, '22023', 'sla_limits_invalid', 'valor nulo é recusado');
select lives_ok($$select public.update_sla_settings(5, 20, 45, 720, 120, 600, 2880)$$, 'dono altera os limites');
select is((public.get_sla_settings()->>'team_red_until_minutes')::int, 720, 'limites novos valem');
select is((public.get_sla_settings()->>'followup_level1_minutes')::int, 120, 'e o primeiro nível de follow-up também');
select is((public.get_sla_settings()->>'is_default')::boolean, false, 'deixa de ser padrão');
reset role;
select is((select count(*)::int from public.audit_events where action = 'sla.limits_changed'), 1, 'a mudança de limites foi auditada');
select ok(
    (select (metadata->'previous'->>'team_red_until_minutes') = '1440' and (metadata->'current'->>'team_red_until_minutes') = '720'
     from public.audit_events where action = 'sla.limits_changed'),
    'a auditoria guarda o valor anterior e o novo'
);

set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000003';
select is((public.get_sla_settings()->>'team_red_until_minutes')::int, 1440, 'outro workspace continua com os padrões');
select is((select count(*)::int from public.workspace_sla_settings), 0, 'e não lê os limites de outro workspace');
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000002';
select is((select count(*)::int from public.workspace_sla_settings), 1, 'atendente lê os limites do próprio workspace');
reset role;
-- volta aos padrões para o resto dos testes
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000001';
select lives_ok($$select public.update_sla_settings(10, 15, 30, 1440, 360, 1440, 4320)$$, 'dono volta aos padrões');
reset role;

-- ─── Regra única: quem tem prazo ─────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000001';
select is(private.sla_applies((select a from sl_ids)), true, 'conversa individual comum tem prazo');
select is(private.sla_applies((select grp from sl_ids)), false, 'GRUPO nunca tem prazo');
select is(private.is_self_conversation((select self from sl_ids)), true, 'detecta a conversa consigo mesmo (número da própria conexão)');
select is(private.sla_applies((select self from sl_ids)), false, 'conversa consigo mesmo nunca tem prazo');
select is(private.is_self_conversation((select a from sl_ids)), false, 'conversa de cliente não é "consigo mesmo"');

create temp table sl_inbox on commit drop as
select i as item from jsonb_array_elements(public.get_conversations_inbox('all', null, null, null, 100)->'items') as i;
grant select on sl_inbox to authenticated;
select is((select item->>'sla_direction' from sl_inbox where item->>'conversation_id' = (select a::text from sl_ids)), 'incoming', 'lista: cliente comum mostra a direção do prazo');
select is((select item->>'sla_direction' from sl_inbox where item->>'conversation_id' = (select grp::text from sl_ids)), null, 'lista: grupo sem prazo');
select is((select item->>'sla_direction' from sl_inbox where item->>'conversation_id' = (select self::text from sl_ids)), null, 'lista: conversa consigo mesmo sem prazo');
select is((select item->>'sla_at' from sl_inbox where item->>'conversation_id' = (select self::text from sl_ids)), null, 'lista: conversa consigo mesmo sem hora de prazo');
select is((select (item->>'is_self')::boolean from sl_inbox where item->>'conversation_id' = (select self::text from sl_ids)), true, 'lista: marca a conversa consigo mesmo');
select is((public.get_conversation_item((select grp from sl_ids))->>'sla_direction'), null, 'cabeçalho: grupo sem prazo');
select is((public.get_conversation_item((select a from sl_ids))->>'sla_mode'), 'active', 'cabeçalho: modo do prazo é devolvido');
select is((public.get_conversation_item((select a from sl_ids))->>'sla_direction'), 'incoming', 'cabeçalho: cliente comum com prazo');

-- ─── Pausa até o cliente falar de novo ───────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000002';
select throws_ok(format($$select public.set_conversation_sla_mode(%L, 'paused')$$, (select prot from sl_ids)), '42501', 'sla_not_authorized', 'atendente não mexe no prazo de conversa que não enxerga');
select throws_ok(format($$select public.set_conversation_sla_mode(%L, 'paused')$$, (select grp from sl_ids)), '42501', null, 'atendente não mexe em grupo restrito ao dono');
select throws_ok(format($$select public.set_conversation_sla_mode(%L, 'inexistente')$$, (select a from sl_ids)), '22023', 'sla_mode_invalid', 'modo inválido é recusado');
select is((public.set_conversation_sla_mode((select a from sl_ids), 'paused')->>'status'), 'success', 'atendente com acesso pausa o prazo');
select is((public.set_conversation_sla_mode((select a from sl_ids), 'paused')->>'status'), 'unchanged', 'pausar de novo não muda nada');
select is((public.get_conversation_item((select a from sl_ids))->>'sla_direction'), null, 'pausado: some o prazo no cabeçalho');
select is((public.get_conversation_item((select a from sl_ids))->>'sla_mode'), 'paused', 'pausado: o estado é visível');
select is(
    (select count(*)::int from jsonb_array_elements(public.get_sla_conversations()) e where e->>'conversation_id' = (select a::text from sl_ids)),
    0, 'pausado: sai do painel de Prioridades'
);
select is(
    (select count(*)::int from jsonb_array_elements(public.get_kanban_board()) s, jsonb_array_elements(s->'cards') c
     where c->>'linked_conversation_id' = (select a::text from sl_ids) and c->>'last_msg_direction' is not null),
    0, 'pausado: o card do Kanban fica sem prazo'
);

-- nova mensagem do cliente DEPOIS da pausa: o prazo volta sozinho
reset role;
select public.ingest_whatsapp_text_message('sl_instance', 'sl-a-2', '5582988885500@s.whatsapp.net', false, 'Cliente A', 'Ainda estou aqui', clock_timestamp() + interval '1 minute');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000002';
select is((public.get_conversation_item((select a from sl_ids))->>'sla_direction'), 'incoming', 'cliente falou de novo: o prazo volta sozinho');
select is(
    (select count(*)::int from jsonb_array_elements(public.get_sla_conversations()) e where e->>'conversation_id' = (select a::text from sl_ids)),
    1, 'e a conversa volta ao painel de Prioridades'
);

-- ─── Desativar de vez ────────────────────────────────────────────────────────────────────────────
select is((public.set_conversation_sla_mode((select a from sl_ids), 'disabled')->>'status'), 'success', 'desativar o prazo (permanente)');
reset role;
select public.ingest_whatsapp_text_message('sl_instance', 'sl-a-3', '5582988885500@s.whatsapp.net', false, 'Cliente A', 'Mais uma mensagem', clock_timestamp() + interval '2 minutes');
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000002';
select is((public.get_conversation_item((select a from sl_ids))->>'sla_direction'), null, 'desativado: nova mensagem do cliente NÃO traz o prazo de volta');
select is((public.set_conversation_sla_mode((select a from sl_ids), 'active')->>'status'), 'success', 'reativar manualmente');
select is((public.get_conversation_item((select a from sl_ids))->>'sla_direction'), 'incoming', 'reativado: o prazo volta');
select throws_ok(format($$select public.set_conversation_sla_mode(%L, 'paused')$$, (select self from sl_ids)), '22023', 'sla_not_applicable', 'conversa consigo mesmo: não há prazo para pausar');

-- ─── Painel de Prioridades ───────────────────────────────────────────────────────────────────────
select is(
    (select count(*)::int from jsonb_array_elements(public.get_sla_conversations())),
    2, 'painel (atendente): só as duas conversas individuais com prazo (sem grupo, consigo mesmo, protegida nem encerrada)'
);
select is(
    (select e->>'conversation_id' from jsonb_array_elements(public.get_sla_conversations()) e limit 1),
    (select b::text from sl_ids), 'painel: ordenado da mais antiga para a mais nova'
);
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000001';
select is(
    (select count(*)::int from jsonb_array_elements(public.get_sla_conversations())),
    3, 'painel (dono): também a conversa de contato protegido'
);

-- ─── Outro workspace e anon ──────────────────────────────────────────────────────────────────────
set local "request.jwt.claim.sub" = 'b5500000-0000-4000-8000-000000000003';
select throws_ok(format($$select public.set_conversation_sla_mode(%L, 'paused')$$, (select a from sl_ids)), '42704', 'conversation_not_available', 'owner de outro workspace não mexe no prazo alheio');
select is(jsonb_array_length(public.get_sla_conversations()), 0, 'owner de outro workspace não vê conversas alheias no painel');
reset role;
set local role anon;
select throws_ok($$select public.get_sla_settings()$$, '42501', null, 'anon não lê limites');
reset role;

select * from finish();
rollback;
