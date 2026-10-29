-- ROLLBACK da migration 20260802006800_web_push.sql (manual; NÃO é uma migration).
--
-- Remove as duas funções de Web Push e a tabela de assinaturas. Perde-se só a lista de aparelhos com aviso ligado (as pessoas
-- reativam em Preferências depois); nenhuma mensagem, conversa ou contato é tocado. O app desta versão usa a tabela e as funções:
-- faça o rollback do app antes ou junto (sem elas o recurso de avisos com o app fechado deixa de funcionar e a tela de Preferências
-- mostra erro ao listar aparelhos; o restante do app segue normal, e o webhook trata a falha do aviso sem afetar a resposta à Evolution).
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802006800
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.get_push_targets(uuid);
drop function if exists public.register_push_subscription(text, text, text, text, text);
drop table if exists public.push_subscriptions;

commit;
