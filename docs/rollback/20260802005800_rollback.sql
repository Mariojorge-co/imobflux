-- ROLLBACK da migration 20260802005800_message_actions_rpcs.sql (manual; NÃO é uma migration).
--
-- Remove as funções das ações sobre mensagens. Nenhum dado é apagado (as colunas/tabelas ficam até o rollback da 005700).
-- O app desta versão chama estas funções: faça o rollback do app antes ou junto.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005800
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.ingest_whatsapp_reaction(text, text, text, boolean, text);
drop function if exists public.ingest_whatsapp_message_delete(text, text);
drop function if exists public.ingest_whatsapp_message_edit(text, text, text, timestamptz);
drop function if exists private.find_message_by_external(text, text);
drop function if exists public.commit_message_reaction(uuid, uuid, text);
drop function if exists public.begin_message_reaction(uuid, text);
drop function if exists public.mark_message_forwarded(uuid, uuid);
drop function if exists public.get_message_for_forward(uuid);
drop function if exists public.restore_hidden_message(uuid);
drop function if exists public.hide_message(uuid);
drop function if exists public.commit_message_revoke(uuid, uuid, text);
drop function if exists private.apply_message_deletion(uuid, uuid, text);
drop function if exists public.begin_message_revoke(uuid);
drop function if exists public.commit_message_edit(uuid, text, uuid, text);
drop function if exists public.begin_message_edit(uuid, text);
drop function if exists public.set_incoming_message_reply(uuid, text, jsonb);
drop function if exists public.set_message_reply(uuid, uuid);
drop function if exists private.message_snapshot(uuid);
drop function if exists private.load_action_message(uuid, boolean);
drop function if exists private.outgoing_route(uuid, uuid);

commit;
