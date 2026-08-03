# HANDOFF técnico — ImobFlux

## 1. Visão geral

O ImobFlux é um CRM para corretores imobiliários. O objetivo do MVP atual é
permitir que um corretor individual, como OWNER de um único workspace, organize
contatos e evolua posteriormente para conversas, prioridades, kanban e demais
operações comerciais.

Estado atual do MVP:

- autenticação local com Supabase Auth;
- bootstrap controlado do primeiro OWNER;
- PostgreSQL local com 18 tabelas de domínio;
- RLS de leitura para OWNER ativo;
- módulo funcional de Contatos com escrita controlada, auditoria e interface;
- demais módulos de negócio ainda somente leitura;
- WhatsApp, ATTENDANT e múltiplos usuários adiados.

Stack: Next.js 16.2.12 com App Router, React 19, TypeScript, Tailwind CSS,
ESLint, Lucide React, `@supabase/ssr@0.12.3`,
`@supabase/supabase-js@2.110.8`, PostgreSQL/Supabase local e Playwright
1.62.1 usando o Chrome instalado.

A arquitetura separa rotas e Server Actions em `app/`, componentes visuais em
`components/`, acesso e regras de servidor em `lib/`, tipos compartilhados em
`types/` e banco/testes SQL em `supabase/`. Não há pasta `src/`.

## 2. Estrutura relevante

- `app/`: rotas App Router, layouts, páginas, loading/error boundaries e Server
  Actions de autenticação e Contatos.
- `components/`: AppLayout, Sidebar, Topbar, componentes de autenticação,
  Prioridades, Contatos e Design System reutilizável.
- `lib/`: DAL e segurança de autenticação, clientes Supabase, proxy de sessão,
  bootstrap, normalização/validação e leitura de Contatos.
- `types/`: tipos de banco, contatos e Prioridades.
- `supabase/migrations/`: migrations forward-only do schema e das operações
  aprovadas.
- `supabase/tests/database/`: quatro suítes pgTAP de integridade, autenticação,
  RLS e operações de Contatos.
- `tests/`: Playwright de autenticação/fluxo e testes unitários executados pelo
  Playwright.
- `docs/`: modelo de domínio, permissões, fluxos, modelo lógico, schema e
  decisões técnicas.
- `package.json`, `eslint.config.mjs`, `playwright.config.ts`, `next.config.ts`,
  `postcss.config.mjs` e `tsconfig.json`: configuração e comandos do projeto.

Artefatos gerados como `node_modules/`, `.next/`, `supabase/.temp/`,
`supabase/.branches/` e `test-results/` não fazem parte da estrutura de código.

## 3. Sprints concluídas

Foram confirmadas no repositório a fundação visual e de navegação, o Design
System base, as páginas vazias do app, a modelagem do domínio, o schema
PostgreSQL, o hardening de integridade, a autenticação local, o bootstrap
inicial, a compensação/reconciliação de Auth, a RLS de leitura do OWNER e a
liberação incremental de escrita para Contatos.

As dez migrations existentes são:

1. `20260802000100_create_foundation.sql` — usuários, workspaces e memberships;
2. `20260802000200_create_contacts_and_channels.sql` — contatos, pontos e canais;
3. `20260802000300_create_conversations.sql`;
4. `20260802000400_create_commercial_operations.sql`;
5. `20260802000500_create_audit_and_technical_triggers.sql`;
6. `20260802000600_harden_schema_integrity.sql`;
7. `20260802000700_add_local_auth_and_initial_bootstrap.sql`;
8. `20260802000800_grant_service_role_bootstrap_access.sql`;
9. `20260802000900_enable_owner_rls.sql`;
10. `20260802001000_add_contact_operations.sql` — única migration criada para a
    Sprint 14.

As nove migrations históricas não devem ser reescritas.

## 4. Estado exato da Sprint 14 — Contatos

Arquivos principais criados ou alterados nesta sprint:

- `app/(app)/contatos/page.tsx`, `loading.tsx`, `error.tsx` e `actions.ts`;
- `components/contatos/contacts-client.tsx`;
- `lib/contacts/data.ts`, `phone.ts` e `validation.ts`;
- `types/contacts.ts` e `types/database.ts`;
- `components/ui/select.tsx`, exportação do índice de UI, Sidebar e proxy de
  sessão;
- `supabase/migrations/20260802001000_add_contact_operations.sql`;
- `supabase/tests/database/contact_operations.test.sql` e ajustes de expectativa
  nas suítes existentes;
- `tests/contact-validation.unit.spec.ts` e `tests/auth-flow.spec.ts`;
- `README.md`, `docs/SCHEMA_POSTGRESQL.md` e `docs/DECISOES.md`.

A migration 10 cria somente estas cinco RPCs públicas:

- `create_contact`;
- `update_contact`;
- `set_contact_operational_status`;
- `archive_contact`;
- `restore_contact`.

As cinco são `SECURITY DEFINER`, pertencem a `postgres`, usam `search_path`
vazio, objetos qualificados e não usam SQL dinâmico. Todas exigem exatamente um
contexto OWNER ativo fornecido por `private.active_owner_context()`, derivando
`workspace_id` e `member_id` da sessão. `PUBLIC`, `anon` e `service_role` não têm
EXECUTE; somente `authenticated` tem EXECUTE. Escrita direta de
`authenticated` em `contacts`, `contact_points` e `audit_events` continua
revogada.

Operações disponíveis: cadastrar, editar, inativar, reativar, arquivar e
restaurar. Não existe hard delete. A criação usa `lead`, `active` e não protegido
como padrão. Campos de privacidade, workspace e membro não são aceitos pelas
RPCs.

Telefones são opcionais. A normalização aceita 10 ou 11 dígitos nacionais, ou
`+55` seguido de 10 ou 11 dígitos nacionais, preservando a apresentação
informada. Um prefixo internacional explícito diferente de `+55` é rejeitado.
Não há invenção de DDD, nono dígito, conversão internacional, coluna de telefone
principal ou índice trigram.

Quando há mais de um telefone ativo, a listagem não escolhe um valor e a edição
é recusada com segurança pela interface e pela RPC. Contato, telefone e evento
de auditoria são gravados na mesma transação. A auditoria registra ação, alvo,
ator e metadados técnicos, sem nome, telefone ou conteúdo do formulário.

A rota `/contatos` tem busca por nome/telefone, filtros por classificação,
status e arquivamento, paginação offset de 20 itens, estados vazio, loading,
erro, sem resultados e ações responsivas para desktop/tablet. A tabela desktop
e os cards mobile usam os mesmos dados, sem dados fictícios.

## 5. Sprint 14 concluída e validações

O módulo de Contatos está totalmente funcional e a Sprint 14 foi concluída com sucesso.

Fatos e validações confirmadas:

- As 10 migrations existentes estão aplicadas e consolidadas no banco de dados local;
- Módulo funcional de Contatos completo (cadastrar, editar, inativar, reativar, arquivar, restaurar);
- Feedback de arquivamento/restauração corrigido em `components/contatos/contacts-client.tsx` com estado de ciclo de vida unificado e callback estabilizado com `useCallback`;
- pgTAP mais recente: 219 testes aprovados;
- Playwright final: 32/32 testes aprovados (100% de sucesso);
- Lint web (`npm run lint`): aprovado sem erros ou warnings;
- Build (`npm run build`): aprovado com compilação limpa (Next.js 16.2.12 com Turbopack);
- Inspeção do bundle público (`.next/static/chunks/*.js`): zero ocorrências de vazamento de chaves ou tokens;
- Supabase local encerrado com sucesso (`supabase stop`), com backup e volumes preservados.

## 6. Pendências imediatas

Nenhuma pendência técnica aberta da Sprint 14. O projeto está validado e pronto para a criação do primeiro commit-base.

## 7. Decisões obrigatórias

- O domínio permanece com 18 tabelas e migrations forward-only.
- Migrations históricas são imutáveis; correções usam nova migration.
- O isolamento por `workspace_id` é obrigatório.
- A interface atual é exclusiva do OWNER individual.
- ATTENDANT, equipe, convites, múltiplos usuários e transferência de OWNER estão
  adiados.
- RLS permanece habilitada nas 18 tabelas.
- Contatos só podem ser escritos por RPCs controladas e auditadas.
- `authenticated` não recebe escrita direta.
- `service_role` não é DAL comercial e não teve privilégios ampliados.
- Workspace e membro são derivados da sessão, nunca enviados pelo cliente.
- Auditoria é permanente e não contém PII.
- Não há WhatsApp, sincronização externa ou expansão para vendas nesta fase.
- Não há hard delete em uso normal.
- Telefone segue exclusivamente as regras brasileiras de 10/11 dígitos e
  prefixo `+55`.
- O fuso inicial do workspace é `America/Maceio`.
- Contato protegido, privacidade e campos protegidos não são alterados pelas
  RPCs de Contatos.
- Mais de um telefone ativo implica recusa segura de edição; nenhum telefone é
  escolhido ou removido arbitrariamente.
- Não adicionar índice trigram, telefone principal ou alterações especulativas
  no modelo.

## 8. Segurança

Autenticação e bootstrap ficam em `lib/auth/`, nas rotas `app/(auth)/` e nos
clientes Supabase. `lib/auth/dal.ts` valida usuário, `app_user`, membership OWNER
e workspace ativos. `proxy.ts` renova a sessão; o layout privado repete a
autorização no servidor.

`private.active_owner_context()` deriva a identidade do `auth.uid()` e é usado
pelas policies e RPCs. As cinco RPCs de Contatos são as únicas novas funções
`SECURITY DEFINER`; não há cliente administrativo usado como DAL comercial.

A chave pública é lida por `NEXT_PUBLIC_SUPABASE_CLIENT_KEY`. A chave
administrativa, quando necessária para bootstrap/Auth, é somente
`SUPABASE_ADMIN_KEY` no servidor. O token inicial é
`IMOBFLUX_BOOTSTRAP_TOKEN`. Os valores nunca devem ser registrados, enviados ao
cliente ou incluídos no bundle.

O ambiente esperado é descrito em `.env.example`; nenhum valor deve ser salvo
neste handoff. Não acessar ambiente remoto sem autorização. Comandos Supabase
devem usar a CLI fixada e `--local`; nunca usar `--linked`, `--db-url`, login,
link, push ou pull nesta etapa.

## 9. Validação

Comandos disponíveis no `package.json`:

- `npm.cmd run dev`;
- `npm.cmd run build`;
- `npm.cmd run start`;
- `npm.cmd run lint`;
- `npm.cmd run test:auth`.

Comandos locais da CLI, sempre com a versão exata, são:

```text
npx.cmd --yes supabase@2.111.0 start
npx.cmd --yes supabase@2.111.0 db reset --local --no-seed
npx.cmd --yes supabase@2.111.0 test db --local
npx.cmd --yes supabase@2.111.0 db lint --local --level warning
```

Existem 4 suítes pgTAP (`auth_bootstrap`, `contact_operations`, `owner_rls` e
`schema_integrity`) e 32 testes Playwright/“unitários” executados pelo runner
Playwright. A suíte de Contatos inclui normalização de telefone, isolamento,
permissões, atomicidade, auditoria e ciclo de arquivamento/restauração.

Após uma alteração somente em testes, executar primeiro a fatia direcionada
com seus pré-requisitos de fixture; não repetir suítas caras sem necessidade.
Após alteração de produção, repetir lint/build e as validações afetadas. Não
declarar pgTAP ou lint/build como executados após a última correção sem uma nova
execução real.

## 10. Estado do Git

- Branch identificável: `main`.
- Criação autorizada do primeiro baseline local na branch `main`.
- Nenhum repositório remoto está configurado.
- Nenhuma publicação remota foi realizada.
- `.gitignore` atualizado para ignorar `test-results/` e `playwright-report/`.

## 11. Como iniciar no Antigravity

1. Ler integralmente este `HANDOFF.md`.
2. Ler `AGENTS.md`, `README.md` e os documentos apontados em `docs/`.
3. Inspecionar `git status --short` e o diff/estado real dos arquivos.
4. Confirmar que a implementação persistente do feedback corresponde a este
   handoff.
5. Apresentar um plano curto antes de alterar qualquer arquivo.
6. Continuar pelas pendências de validação, sem reimplementar a Sprint 14.
7. Não modificar decisões aprovadas sem autorização explícita.
