-- ROLLBACK da migration 20260802006700_global_search.sql (manual; NÃO é uma migration).
--
-- Remove a função de busca global, o auxiliar privado de candidatos e o índice trigram. Nenhum dado é tocado. A extensão pg_trgm é mantida (outras coisas
-- podem usá-la; remover é opcional: drop extension pg_trgm;). O app desta versão usa a função: faça o rollback do app
-- antes ou junto (a busca global deixa de funcionar sem ela; o restante do app segue normal).
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802006700
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.search_global(text, integer, integer);
drop function if exists private.search_message_candidates(text, integer);
drop index if exists public.idx_messages_text_trgm;

commit;
