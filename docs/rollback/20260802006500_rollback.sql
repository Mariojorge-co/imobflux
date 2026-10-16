-- ROLLBACK da migration 20260802006500_today_overview.sql (manual; NÃO é uma migration).
--
-- Remove só a função de leitura do painel "Hoje". Nenhum dado é tocado. O app desta versão usa a função: faça o rollback do app
-- antes ou junto (o painel "Hoje" deixa de carregar sem ela).
-- Se a migration for considerada revertida: supabase migration repair --status reverted 20260802006500
-- Como usar (produção, só com autorização): begin; \i este-arquivo.sql; -- conferir; commit;

begin;

drop function if exists public.get_today_overview(integer);

commit;
