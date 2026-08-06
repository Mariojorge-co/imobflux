# Arquitetura do Sistema — ImobFlux

Documento técnico descritivo da arquitetura, padrões e convenções adotadas no projeto **ImobFlux**. Este documento orienta o desenvolvimento para garantir consistência estrutural, segurança e manutenibilidade.

---

## 1. Princípios Arquiteturais Fundamentais

1. **Single Source of Truth no PostgreSQL**: As regras de negócio críticas, integridade referencial, RLS e auditoria residem no banco de dados PostgreSQL/Supabase.
2. **Defesa em Profundidade (Zero Trust RLS)**: Nenhuma tabela de domínio é exposta diretamente sem controle RLS. Toda leitura exige sessão autenticada resolvida em `private.active_owner_context()`.
3. **Escritas Controladas por RPC**: Alterações de dados que possuem impacto em auditoria ou estados de domínio não utilizam mutação direta client-side via PostgREST (`UPDATE`/`DELETE` direto em tabelas de domínio são revogados para a role `authenticated`). As alterações são executadas por RPCs `SECURITY DEFINER` fortemente validadas.
4. **Leituras Performáticas via Server Components**: Consultas de exibição são resolvidas preferencialmente no servidor (RSC) com suporte a RPCs `SECURITY INVOKER` para agregação ou queries diretas PostgREST seguras pela RLS.
5. **Isolamento Estrito de Tenant**: Todo registro pertence a um `workspace_id`. O Next.js **nunca** confia no `workspace_id` vindo do cliente; o contexto de tenant é sempre derivado da sessão do usuário no banco.

---

## 2. Estrutura de Diretórios

```text
CRM Corretor/
├── app/                        # Next.js App Router (Rotas, Layouts, Pages e Actions)
│   ├── (app)/                  # Grupo de rotas privadas autenticadas (/prioridades, /contatos, /conversas, etc.)
│   ├── (auth)/                 # Grupo de rotas públicas de autenticação (/login, /setup)
│   ├── api/                    # Route Handlers / API endpoints (se aplicável)
│   ├── globals.css             # Design System Tokens e utilitários CSS Vanilla
│   ├── layout.tsx              # Root Layout
│   └── page.tsx                # Redirecionador inicial
├── components/                 # Componentes React (UI atômica e módulos)
│   ├── auth/                   # Componentes de autenticação
│   ├── contatos/               # Componentes do módulo de Contatos
│   ├── conversas/              # Componentes do módulo de Conversas
│   ├── prioridades/            # Componentes do módulo de Prioridades
│   └── ui/                     # Design System Atômico (Button, Card, Input, SearchInput, etc.)
├── lib/                        # Camada de lógica de negócios e dados no servidor/cliente
│   ├── auth/                   # Lógica de autenticação e sessão
│   ├── contatos/               # Server Actions e Data Fetching de Contatos
│   ├── conversas/              # Server Actions e Data Fetching de Conversas
│   ├── prioridades/            # Data Fetching de Prioridades
│   ├── supabase/               # Clientes do Supabase (server, client, admin, proxy)
│   ├── date.ts                 # Utilitários nativos de data (sem date-fns)
│   └── validation.ts           # Validações de formulário e regex (ex: telefone BR)
├── supabase/                   # Configuração e código da base de dados PostgreSQL
│   ├── migrations/             # Migrations versionadas por timestamp YYYYMMDDHHMMSS
│   ├── tests/                  # Testes SQL unitários pgTAP
│   └── config.toml             # Configuração local da CLI do Supabase
├── tests/                      # Testes E2E e unitários TypeScript (Playwright)
├── types/                      # Definições de tipos TypeScript
│   └── database.ts             # Tipos autogerados da base local Supabase (UTF-8)
└── docs/                       # Documentação técnica Single Source of Truth
    └── sprints/                # Histórico individual por sprint
```

---

## 3. Padrões de Componentes e Fluxo de Dados

### 3.1. React Server Components (RSC) vs Client Components
- **Server Components (Padrão)**: Todas as páginas em `app/` são Server Components por padrão (`async function Page()`). Elas realizam Data Fetching assíncrono diretamente no servidor via funções `lib/<domain>/data.ts`.
- **Client Components (`"use client"`)**: Utilizados exclusivamente para interatividade no cliente (estado de formulário, debounce de busca, modais, eventos de clique/teclado). Devem ser mantidos o mais isolados e folha possível na árvore de componentes.

### 3.2. Server Actions (`"use server"`) vs Data Fetching (`server-only`)
- **Data Fetching (`lib/<domain>/data.ts`)**: Funções anotadas com `import "server-only"`. Consumidas exclusivamente por Server Components para buscar dados do banco via `createServerSupabaseClient()`.
- **Server Actions (`lib/<domain>/actions.ts`)**: Funções anotadas com `"use server"`. Consumidas por Client Components para manipular submissões de formulário, buscas reativas em tempo real ou mutações disparadas pela UI.

---

## 4. Estratégia de Acesso ao Banco de Dados (RPC vs Query Direta)

### Quando usar RPC:
1. **Mutações de Domínio (`SECURITY DEFINER`)**: Cadastrar, editar, inativar ou arquivar entidades onde regras de validação, integridade e geração de auditoria devem ser executadas atomicamente no banco sem dar permissão de `UPDATE`/`DELETE` direto na tabela para a role `authenticated`.
2. **Consultas Agregadas Complexas (`SECURITY INVOKER`)**: Consultas como `get_prioridades_dashboard` e `get_conversations_list` que exigem subconsultas (`LATERAL JOIN`), agregações por regras de negócio ou paginação por cursor estável. A RPC deve ser `SECURITY INVOKER` para que o Supabase/Postgres aplique automaticamente as políticas de RLS do usuário autenticado sobre as tabelas consultadas.

### Quando usar Query Direta (PostgREST / Supabase Client):
1. **Consultas Simples em Server Components**: Consultas diretas em tabelas de domínio (ex: `supabase.from("messages").select(...)`) onde a política de `SELECT` da RLS é suficiente para garantir isolamento e onde a consulta não exige lógica procedural complexa no banco.

---

## 5. Autenticação, Sessão e Contexto de Tenant

- **Cookies HTTP-Only & SSR Proxy**: A autenticação utiliza o Supabase Auth integrado com os novos helpers de servidor do Next.js App Router (`lib/supabase/server.ts`). A renovação e validação da sessão ocorrem em middleware proxy sem expor tokens no `localStorage`.
- **Contexto de Autorização (`private.active_owner_context()`)**:
  - A função SQL `private.active_owner_context()` resolve a identidade do usuário autenticado (`auth.uid()`) e verifica se ele possui associação ativa com o workspace.
  - Todas as políticas de RLS das 18 tabelas de domínio referenciam essa função SQL estável para filtrar os registros por `workspace_id`.
  - Nenhuma API ou Server Action pode passar `workspace_id` como parâmetro confiável do cliente.

---

## 6. Organização de Migrations e Testes

### 6.1. Migrations PostgreSQL
- **Nomeação**: `YYYYMMDDHHMMSS_descricao.sql` em `supabase/migrations/`.
- **Regras**:
  - Migrations são estritamente **append-only**. Nunca editar uma migration já aplicada em sprints anteriores.
  - Toda migration deve incluir privilégios explícitos (`GRANT`/`REVOKE`) para as roles `authenticated`, `anon` e `service_role`.

### 6.2. Testes de Banco (pgTAP)
- Arquivos localizados em `supabase/tests/database/`.
- Testam integridade de schema, presença de RLS em todas as tabelas, comportamentos de triggers, privilégios de roles e execução funcional das RPCs.

### 6.3. Testes End-to-End (Playwright)
- Arquivos localizados em `tests/`.
- Cobrem fluxos reais do navegador: Login, Bootstrap, Navegação de rotas protegidas, Manipulação de Contatos, Busca com debounce e Módulo de Conversas.

---

## 7. Design System e Styling

- **Vanilla CSS com Design Tokens**: Tokens centralizados em `app/globals.css` utilizando variáveis CSS customizadas (`--color-background`, `--color-surface`, `--color-primary`, `--spacing-page`, etc.).
- **Sem Frameworks de Componentes Pesados**: Componentes UI nativos construídos em `components/ui/` com classes CSS utilitárias.
- **Acessibilidade (a11y)**: Uso rigoroso de marcação semântica (`<main>`, `<nav>`, `<header>`, `role="log"`, `role="list"`), atributos `aria-label`, `aria-busy`, `aria-live` e suporte a navegação por teclado (Enter, Escape).
- **Datas Nativas**: Formatação de datas exclusivamente via API nativa `Intl` / `Date` em `lib/date.ts` (proibido o uso da biblioteca `date-fns`).
