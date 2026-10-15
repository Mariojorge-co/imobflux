-- ROLLBACK da migration 20260802006100_conversation_search_and_notes.sql (manual; NÃO é uma migration).
--
-- Remove só as 4 funções novas (busca na conversa, editar/apagar nota, listar notas). Nenhum dado é tocado; as notas já
-- apagadas (archived_at) continuam arquivadas. O app desta versão usa as funções: faça o rollback do app antes ou junto.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802006100
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.search_conversation_messages(uuid, text, integer);
drop function if exists public.update_internal_note(uuid, text);
drop function if exists public.archive_internal_note(uuid);
drop function if exists public.list_conversation_notes(uuid, uuid);

commit;
