-- ROLLBACK da migration 20260802005200_quick_replies.sql (manual; NÃO é uma migration).
--
-- Remove respostas rápidas e categorias. ATENÇÃO: apaga os dados dessas duas tabelas (modelos e categorias criados pela
-- equipe); exporte antes se importar. Eventos de auditoria "quick_reply.*" já gravados permanecem (a auditoria é imutável).
-- O app desta versão chama as funções removidas: faça o rollback do app (ou do deploy) antes ou junto.
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802005200
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.add_example_quick_replies();
drop function if exists public.record_quick_reply_use(uuid);
drop function if exists public.delete_quick_reply(uuid);
drop function if exists public.save_quick_reply(uuid, text, text, uuid, boolean);
drop function if exists public.delete_quick_reply_category(uuid);
drop function if exists public.save_quick_reply_category(uuid, text);
drop function if exists public.get_quick_replies();
drop table if exists public.quick_replies;
drop table if exists public.quick_reply_categories;

commit;
