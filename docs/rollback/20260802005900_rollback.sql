-- ROLLBACK da migration 20260802005900_conversation_pins.sql (manual; NÃO é uma migration).
--
-- Remove a função e a tabela de conversas fixadas (APAGA as fixações de todos). Faça o rollback da 006000 antes (a lista
-- usa a tabela). Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005900
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.set_conversation_pin(uuid, boolean);
drop table if exists public.conversation_pins;

commit;
