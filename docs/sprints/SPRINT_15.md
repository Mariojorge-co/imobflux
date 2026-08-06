# Relatório da Sprint 15 — Conectar Prioridades ao Banco Real

## 1. Objetivo
Substituir integralmente os dados fictícios da página de Prioridades (`lib/prioridades-data.ts`) por dados reais do banco PostgreSQL/Supabase, consumidos via RPC segura de leitura no banco de dados.

## 2. Escopo
- Criar RPC `get_prioridades_dashboard()` no PostgreSQL.
- Implementar 4 regras objetivas de prioridade comercial sobre a tabela `contacts`:
  1. Contatos ativos sem telefone cadastrado.
  2. Contatos ativos classificados como `person` e aguardando qualificação.
  3. Leads ativos com cadastro sem revisão há mais de 15 dias (`updated_at < NOW() - 15 dias`).
  4. Contatos recém-criados nos últimos 7 dias ainda não qualificados como lead ou client.
- Conectar a página `/prioridades` à RPC via Server Component.
- Garantir que as categorias possam se sobrepor sem exibir soma total falsa.

## 3. Arquivos Criados
- `supabase/migrations/20260802001100_add_prioridades_rpc.sql`
- `lib/prioridades/data.ts`

## 4. Arquivos Alterados
- `app/(app)/prioridades/page.tsx`
- `components/prioridades/prioridades-view.tsx`
- `types/database.ts` (regenerado)

## 5. Migrations
- `20260802001100_add_prioridades_rpc.sql`: Cria a função `public.get_prioridades_dashboard()`.

## 6. RPCs Criadas
- `get_prioridades_dashboard()`:
  - **Tipo**: `SECURITY INVOKER`
  - **Parâmetros**: Nenhum (não aceita `workspace_id` vindo da aplicação).
  - **Segurança**: Depende exclusivamente do contexto de sessão do usuário e das políticas de RLS.
  - **Retorno**: JSON contendo os 4 contadores e as 4 listas de contatos prioritários.

## 7. Testes
- **pgTAP SQL**: Adicionados testes de integridade e privilégios da RPC `get_prioridades_dashboard` em suíte SQL.
- **Playwright E2E**: Teste `shows the Dashboard priorities correctly and filters out archived/inactive` em `tests/auth-flow.spec.ts`.

## 8. Validações Executadas
- `supabase test db` → **PASS** (219 testes).
- `npm run lint` → **PASS** (0 erros, 0 warnings).
- `npm run build` → **PASS**.
- `npm run test:auth` → **PASS** (32 testes).

## 9. Decisões Arquiteturais
- **Não usar `updated_at` como falta de contato comercial**: `updated_at` representa apenas alteração cadastral. Rótulo ajustado para "Cadastro sem revisão recente".
- **Sem parâmetro de tenant na RPC**: A RPC executa sem receber `workspace_id` do cliente, dependendo estritamente do contexto de sessão e RLS.
- **Sobreposição de categorias**: Documentado na UI e nos dados que contatos podem aparecer em mais de uma categoria.

## 10. Limitações
- As 4 listas retornadas pela RPC possuem um limite máximo de 10 itens por card para manter a performance da página inicial.

## 11. Resultado
A página `/prioridades` deixou de usar dados mockados e passou a ser 100% conectada ao PostgreSQL em produção/desenvolvimento local.

## 12. Próxima Etapa
Sprint 15.1 — Refinamento de UX (Polimento de busca e usabilidade).
