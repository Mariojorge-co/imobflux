# Auditoria Técnica Completa — ImobFlux

**Versão Auditada:** `0.1.0` (pós-Sprint 18)
**Data:** 04 de Agosto de 2026
**Escopo:** Arquitetura, Banco de Dados, RLS, RPCs, Segurança, Server Actions, Componentes React, Next.js, UX/UI, Responsividade, Acessibilidade, Performance, Testes, Documentação e Consistência entre módulos.
**Perfis aplicados:** Staff Software Engineer · Tech Lead · Software Architect · Product Designer UX/UI · QA Engineer

---

## 1. Sumário Executivo

O ImobFlux apresenta **fundação técnica sólida e segura**, com escolhas arquiteturais maduras que vão além do que seria esperado para um MVP em estágio inicial. A segurança de dados por tenant é correta e impermeável. A pipeline de build e testes é verde. A separação de responsabilidades entre Server Components, Server Actions e Client Components é exemplar.

Ao mesmo tempo, o projeto carrega **débitos técnicos concretos** que precisam ser endereçados antes de uma abertura para usuários reais. Os mais relevantes são: inconsistência visual severa entre o design system centralizado (`components/ui/`) e os componentes do Kanban (que utilizam classes Tailwind ad hoc); ausência de auto-scroll no painel de mensagens; um antipadrão de consulta no módulo de conversas (`getConversationById` executa uma busca de até 100 itens para encontrar um só); e o webhook que permite execução sem secret configurado.

**Veredicto geral: Apto com ressalvas. Não recomendado para produção sem correção dos itens Críticos.**

---

## 2. Arquitetura Geral

### 2.1 Modelo de Camadas

```
Browser (Client Components)
    ↓ React Server Components (RSC) — leitura via data.ts + RPCs
    ↓ Server Actions ("use server") — escrita + revalidatePath
    ↓ Supabase PostgREST / RPC (autenticado via JWT cookie)
    ↓ PostgreSQL com RLS + SECURITY DEFINER RPCs
                     ↑
External trigger:   Evolution API Webhook → /api/webhooks/whatsapp
                     ↓ Admin Supabase Client → ingest_whatsapp_text_message
```

A separação é consistente e explícita. Nenhuma escrita direta ocorre via PostgREST sem passar por RPC auditada. O uso de `import "server-only"` em `lib/auth/dal.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/kanban/data.ts` e `lib/conversations/data.ts` cria fronteira estática efetiva, com o compilador impedindo vazamentos para o bundle do cliente.

**Avaliação: Excelente.**

### 2.2 Fluxo de Autenticação

O middleware (`proxy.ts`) usa `getClaims()` — não `getUser()` — para renovar sessão silenciosamente sem RTT extra ao servidor Supabase Auth na maioria das requisições. O `dal.ts` usa o cliente admin para resolver o contexto do usuário, contornando o bootstrap circular que RLS imporia se fosse usada a service key diretamente em leitura de dados de aplicação.

**Avaliação: Excelente.**

### 2.3 Risco de Acoplamento

- A `sendMessageAction` centraliza três responsabilidades: validação, enfileiramento no banco via RPC autenticada e gateway externo. Isso é correto para o volume atual, mas se a Evolution API sofrer degradação, a Action falha por completo. Não há nenhum mecanismo de retry ou circuit breaker.
- O webhook não verifica autenticidade por HMAC — usa comparação de string simples. Suficiente, mas não é timing-safe.

---

## 3. Banco de Dados

### 3.1 Schema e Constraints

O schema é **impressionantemente rigoroso** para um projeto neste estágio:

- Todas as constraints de domínio relevantes são declaradas no DDL (`ck_*`), não apenas no código da aplicação.
- As constraints de lifecycle do `workspace_members` (máquina de estados em SQL puro) são raramente vistas em projetos comerciais.
- O uso de `check (btrim(field) <> '')` em todos os campos de texto obrigatórios elimina a classe de bug "string vazia passa a validação".

### 3.2 RPCs e Security Model

**14 RPCs atualmente ativas.** O modelo de segurança é homogêneo:

| Família | Security | Motivo | Correto? |
|---|---|---|---|
| `ingest_whatsapp_text_message` | `DEFINER` + `service_role` | Cria dados sem usuário autenticado | ✅ |
| `queue_outgoing_text_message` | `DEFINER` + `authenticated` | Precisa do contexto do OWNER | ✅ |
| `reconcile_outgoing_text_message` | `DEFINER` + `service_role` | Executada pelo admin após gateway | ✅ |
| `get_kanban_board` | `INVOKER` + `authenticated` | Leitura obedece ao RLS do caller | ✅ |
| `move_opportunity_stage` | `DEFINER` + `authenticated` | Escrita auditada com contexto | ✅ |
| `create_opportunity` | `DEFINER` + `authenticated` | Idem | ✅ |

O `set search_path = ''` é aplicado em todas as funções — correto para prevenir search_path hijacking (CVE-2018-1058).

### 3.3 RLS

18/18 tabelas com RLS habilitado. O padrão `workspace_id IN (SELECT workspace_id FROM private.active_owner_context())` é seguro e determinístico. A função é `STABLE`, o que permite ao planner do PostgreSQL colocá-la em cache por transação.

> [!NOTE]
> A função `private.active_owner_context()` é chamada em cada policy de cada tabela. Como é `STABLE`, o PostgreSQL a executa uma vez por transação — comportamento correto, mas vale monitorar sob carga elevada.

### 3.4 Bug Crítico Detectado: `getConversationById`

```typescript
// lib/conversations/data.ts, linha 91
export async function getConversationById(conversationId: string) {
  const list = await getConversationsList({ limit: 100 });
  return list.find((c) => c.conversation_id === conversationId) ?? null;
}
```

Esta função carrega até 100 conversas do workspace inteiro para encontrar uma específica. Ela é chamada em cada renderização da rota `/conversas/[conversationId]`. Com um workspace com >100 conversas, a conversa pode não ser encontrada, retornando `404` indevidamente. Além disso, gera duas chamadas à RPC `get_conversations_list` em paralelo com `getConversationsList`.

**Correção necessária:** Busca direta por ID via PostgREST ou nova RPC `get_conversation_by_id(p_conversation_id uuid)`.

---

## 4. Backend — Server Actions e Gateway

### 4.1 `sendMessageAction`

**Bem implementado:** Validação UUID explícita com regex, guard de autenticação, idempotência por chave de cliente, reconciliação transacional de status. Erros internos não são propagados ao cliente com detalhes do servidor.

**Problema:** Sem timeout de circuit breaker. Se a Evolution API travar por 10 segundos, a Server Action fica pendurada por até `timeoutMs`, mantendo o request aberto.

### 4.2 `gateway.ts`

`formatPhoneForEvolution` cobre os casos nacionais (10-11 dígitos) e internacionais (12-13 com DDI 55). Para o contexto imobiliário brasileiro, isso é aceitável.

`AbortController` com `setTimeout` para timeout em `fetch` é o padrão correto. ✅

### 4.3 `webhook.ts` — Risco de Segurança

```typescript
// lib/conversations/webhook.ts, linha 47-50
export function validateWebhookSecret(incoming, expected): boolean {
  if (!expected) {
    return true; // Se não configurado no servidor, não bloqueia
  }
  return incoming === expected;
}
```

`validateWebhookSecret` retorna `true` quando `EVOLUTION_WEBHOOK_SECRET` não está configurado no ambiente — qualquer requisição POST não autenticada seria processada. **Perigoso em produção.** Deve haver um guard explícito no ambiente de produção exigindo o secret.

---

## 5. Frontend — Componentes React

### 5.1 Inconsistência Visual — Problema Crítico

O projeto possui **dois sistemas de design incompatíveis em uso simultâneo:**

**Sistema A (Design System Oficial):** `app/globals.css` com tokens CSS (`--color-primary`, `--color-border`, etc.) + `components/ui/`. Usado por: Auth, Contatos, Prioridades, Conversas, layout geral.

**Sistema B (Tailwind Ad Hoc):** Classes Tailwind de cor fixa (`bg-white`, `bg-slate-50`, `border-slate-200`, `text-slate-900`, `bg-blue-600`). Usado por: **todo o módulo Kanban**.

Isso resulta em inconsistência visual imediata ao navegar entre módulos. O restante da aplicação é neutro (preto/branco com primary escuro), enquanto o Kanban tem tons azuis, cinzas de slate e cards brancos com sombras. São literalmente dois produtos visuais diferentes na mesma aplicação.

**Impacto no usuário:** Desorientação visual, sensação de produto inacabado. Um corretor abrindo Contatos e depois Kanban sentirá que mudou de aplicação.

### 5.2 Tipografia e Fontes

`app/globals.css` linha 58: `font-family: Arial, Helvetica, sans-serif;`

Arial é a fonte padrão de 1995. O projeto usa Tailwind mas não carregou nenhuma Google Font. Isso impacta diretamente a percepção de qualidade do produto.

### 5.3 Dark Mode

`globals.css` não define `@media (prefers-color-scheme: dark)` ou classe `.dark`. Os tokens de cor são todos lightmode-only. O módulo Kanban usa `bg-white` e `bg-slate-50` — completamente incompatível com Dark Mode no futuro. Limitação documentada no `STATUS_PROJETO.md`.

### 5.4 `message-form.tsx` — `dangerouslySetInnerHTML` Desnecessário

```tsx
// components/conversations/message-form.tsx, linha 223
dangerouslySetInnerHTML={{
  __html: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
}}
```

`dangerouslySetInnerHTML` para injetar paths SVG hardcoded é desnecessário. Deveria usar o Lucide `<Send />` como todos os outros ícones. Usá-lo sem necessidade normaliza um antipadrão perigoso.

### 5.5 `create-opportunity-dialog.tsx` — Modal Não Nativo

O dialog do Kanban usa `div + fixed inset-0 z-50`, não a tag `<dialog>` nativa. Em contraste, o `ContactFormDialog` usa corretamente `<dialog>` com `.showModal()`.

O modal do Kanban:
- Não captura o foco automaticamente ao abrir (accessibility fail)
- Não fecha com `Escape` (handler não implementado)
- Não retorna o foco ao elemento trigger ao fechar
- Tem `aria-modal="true"` declarado mas sem implementação nativa correspondente

**Exceção:** `aria-labelledby="dialog-title"` e `role="dialog"` estão declarados corretamente.

### 5.6 `kanban-board.tsx` — Rollback com Prop Estale

```tsx
// components/kanban/kanban-board.tsx, linha 80
setStages(initialStages); // ← usa a prop recebida no SSR
```

O rollback usa `initialStages` (prop da renderização SSR inicial), não o estado atual. Se o usuário fez dois movimentos rápidos, o segundo seria perdido no rollback do primeiro. Bug de race condition latente.

### 5.7 `messages-panel.tsx` — Sem Auto-scroll

O painel de mensagens não tem scroll automático para a última mensagem ao abrir. O usuário vê o topo do histórico, não a mensagem mais recente. Para um app de chat/conversa, isso é problema de UX fundamental.

---

## 6. UX e Usabilidade

**Perspectiva: Corretor imobiliário usando o sistema por um dia inteiro**

**Prioridades:** 4 cards de resumo claros, seções bem separadas, dados reais e com valor imediato. ✅

**Contatos:** Funcional. Filtros, busca, paginação, CRUD completo. Formulário usa `<dialog>` nativo com foco correto. Feedback via `aria-live` correto. ✅

**Conversas:** Layout lista + painel correto para desktop, botão Voltar correto no mobile. **Problema UX:** painel abre na mensagem mais antiga (sem auto-scroll). Textarea tem `rows={2}` fixo, sem auto-resize. Status de mensagem não visível nos balões. ⚠️

**Kanban:** Visual inconsistente com o restante. Drag-and-drop funciona em desktop, inacessível sem o menu "Mover". Modal de criação sem busca/filtro nos selects — inutilizável com 100+ contatos. Colunas com scroll interno (`max-h-[calc(100vh-220px)]`) criam scroll dentro de scroll. ⚠️

**Configurações:** Página vazia com `EmptyState`. ⚠️

**Navegação:** Sem indicador de novas mensagens WhatsApp enquanto em outra tela — o corretor precisaria atualizar manualmente (Realtime pendente, documentado). ❌

---

## 7. Acessibilidade (a11y)

### Pontos Fortes

- Sidebar: `aria-label="Navegação principal"` + `aria-current="page"`. ✅
- Topbar: `aria-label="Barra superior"`, `aria-controls`, `aria-expanded` e `aria-label` corretos no hambúrguer. ✅
- `Escape` fecha menu mobile com foco retornando ao botão. ✅
- `ContactFormDialog`: `<dialog>` nativo com `showModal()` — armadilha de foco nativa. ✅
- `MessageForm`: região `aria-live="polite" role="status"` para feedback de envio. ✅
- Ícones Lucide com `aria-hidden="true"` em todos os usos. ✅
- Separadores de data: `role="separator"` e `aria-label`. ✅
- Log de mensagens: `role="log"`. ✅

### Problemas

- **`create-opportunity-dialog.tsx`:** Não usa `<dialog>` nativo. Foco não é capturado ao abrir. `Escape` não fecha. Foco não retorna ao trigger. ❌
- **Kanban drag:** `<div draggable>` não é naturally focável via teclado. O menu "Mover" compensa, mas o drag não é operável por teclado nativamente. ⚠️
- **Campo de telefone em Contatos:** `inputMode="tel"` mas não `type="tel"`. Semanticamente incorreto. ⚠️

---

## 8. Performance

### Carregamento do Kanban

A RPC `get_kanban_board` é uma CTE complexa com `row_number() OVER PARTITION` — eficiente (sem N+1) mas query pesada. A página tem `export const revalidate = 0` — cada acesso gera nova consulta ao banco. Correto para dados dinâmicos; verificar índices em `(status, archived_at, current_stage_id)`.

### Carregamento de Conversas

`getConversationById` busca até 100 conversas para encontrar uma por ID — bug de performance e funcionalidade crítico (ver seção 3.4).

### Bundle e Assets

Sem imagens de conteúdo. `next.config.ts` vazio (configuração default). Lucide com tree-shaking eficiente. ✅

---

## 9. Segurança

| Área | Status | Observação |
|---|---|---|
| Secrets no cliente | ✅ Nenhum | `SUPABASE_ADMIN_KEY`, `EVOLUTION_API_KEY` ficam apenas no servidor |
| Injeção SQL | ✅ Mitigado | SDK parametrizado + RPCs com bindings |
| Tenant isolation (RLS) | ✅ Robusto | 18/18 tabelas, `active_owner_context()` não bypassável |
| Webhook sem HMAC | ⚠️ Risco Médio | Comparação de string simples, não timing-safe |
| `validateWebhookSecret` permissivo | ⚠️ Risco Médio | Retorna `true` sem env var configurada |
| `dangerouslySetInnerHTML` | ⚠️ Risco Baixo | Conteúdo hardcoded, mas antipadrão perigoso |
| CSRF | ✅ Mitigado | Server Actions protegidas pelo mecanismo de origin do Next.js |
| Rate limiting | ❌ Ausente | Sem rate limiting no webhook ou Server Actions |
| Logs de erro | ✅ Correto | `console.error` — não expostos ao cliente |

---

## 10. Testes

### Cobertura

| Arquivo | Tipo | Qualidade |
|---|---|---|
| `auth-flow.spec.ts` | E2E Playwright (browser real) | ✅ Alta |
| `webhook.unit.spec.ts` | Unit (lógica pura) | ✅ Alta |
| `gateway.unit.spec.ts` | Unit (mock de fetch) | ✅ Alta |
| `actions.unit.spec.ts` | Unit (mock de Supabase) | ✅ Boa |
| `message-form.unit.spec.ts` | Unit de lógica JS pura | ⚠️ Limitado — não testa DOM real |
| `kanban-board.unit.spec.ts` | Unit de lógica JS pura | ⚠️ Limitado — apenas 3 testes |
| `kanban-actions.unit.spec.ts` | Unit (mock de Supabase) | ✅ Boa |
| `whatsapp-integration.e2e.spec.ts` | E2E de contrato (sem browser) | ✅ Boa |
| `conversations.spec.ts` | E2E Playwright (browser real) | ✅ Alta |
| `bootstrap.unit.spec.ts` | Unit | ✅ Alta |
| `contact-validation.unit.spec.ts` | Unit | ✅ Alta |

### Problemas

**`message-form.unit.spec.ts`** — 18 testes, mas nenhum renderiza o componente `MessageForm` no DOM. Os testes validam condições JavaScript em variáveis locais (`text.trim() === ""`), não o comportamento real do componente. São testes de contrato de lógica, não de componente.

**`kanban-board.unit.spec.ts`** — apenas 3 testes. O KanbanBoard tem lógica complexa (optimistic update, rollback, pending cards) não testada com renderização real.

**Ausência de:** testes de acessibilidade automatizados (axe-core), testes de snapshot, testes de integração entre componentes.

---

## 11. Documentação

Completa e bem estruturada para o estágio atual:

- `STATUS_PROJETO.md`: Estado atual preciso, sem hipérbole ✅
- `ROADMAP.md`: Fases claras e objetivos definidos ✅
- `HANDOFF.md`: Permite retomada imediata por outro agente/desenvolvedor ✅
- `DECISOES.md`: Registro de ADRs relevantes ✅
- `DOCUMENTATION_POLICY.md`: Política clara de quando e o que documentar ✅
- `SPRINT_17.md`, `SPRINT_18.md`: Histórico permanente de cada sprint ✅

As limitações conhecidas (Realtime, Dark Mode, Mídias) estão documentadas honestamente.

---

## 12. Inventário de Achados

### Críticos — bloqueiam uso em produção

| # | Local | Problema | Impacto |
|---|---|---|---|
| C1 | `lib/conversations/data.ts:91` | `getConversationById` carrega até 100 conversas para encontrar uma — retorna 404 silencioso para workspaces com >100 conversas | Bug funcional |
| C2 | `lib/conversations/webhook.ts:47` | `validateWebhookSecret` retorna `true` sem env var configurada — aceita todos os POSTs não autenticados | Risco de segurança |
| C3 | UI geral | Dois design systems incompatíveis — Kanban visualmente destoante do restante do produto | Produto parece inacabado |

### Importantes — devem ser corrigidos antes de escalar

| # | Local | Problema | Impacto |
|---|---|---|---|
| I1 | `components/conversations/messages-panel.tsx` | Sem auto-scroll para última mensagem ao abrir conversa | UX fundamental de chat |
| I2 | `components/kanban/create-opportunity-dialog.tsx` | Modal não usa `<dialog>` nativo — sem armadilha de foco, sem Escape | Acessibilidade |
| I3 | `components/conversations/message-form.tsx:223` | `dangerouslySetInnerHTML` desnecessário para SVG | Código antipadrão |
| I4 | `app/globals.css:58` | `Arial, Helvetica, sans-serif` — tipografia sem polish | Percepção de qualidade |
| I5 | `components/kanban/kanban-board.tsx:80` | Rollback usa `initialStages` (prop SSR), não estado atual — bug latente | Race condition |
| I6 | `lib/kanban/data.ts` | `getContactsForSelect()` limitado a 100 sem busca — inutilizável com >100 contatos | UX de produção |

### Melhorias Futuras — tech debt aceitável

| # | Local | Problema |
|---|---|---|
| F1 | `lib/conversations/actions.ts` | Sem retry ou circuit breaker para falhas da Evolution API |
| F2 | Geral | Sem rate limiting no webhook nem nas Server Actions |
| F3 | `message-form.tsx` | Textarea com `rows={2}` fixo, sem auto-resize |
| F4 | `message-form.unit.spec.ts` | Testes de lógica JS, não de componente DOM real |
| F5 | `kanban-board.unit.spec.ts` | Apenas 3 testes para lógica complexa de Optimistic UI |
| F6 | Geral | Sem Google Fonts ou fonte customizada |
| F7 | `lib/kanban/data.ts` | `getWorkspaceMembersForSelect` sem cache/memo |
| F8 | `lib/conversations/webhook.ts` | `validateWebhookSecret` usa comparação de string, não `crypto.timingSafeEqual` |

---

## 13. Nota por Área (0–10)

| Área | Nota | Justificativa |
|---|---|---|
| Arquitetura | **9.0** | Separação de camadas exemplar; acoplamento da Action com gateway sem circuit breaker |
| Banco de Dados / Schema | **9.5** | Constraints rigorosas, RPCs seguras; `getConversationById` é o único ponto fraco |
| RLS e Segurança de Dados | **9.5** | 18/18 tabelas, `active_owner_context()` impermeável, search_path hardened |
| Segurança de Aplicação | **7.0** | Webhook sem force-secret, sem timing-safe comparison, sem rate limiting |
| Server Actions | **8.5** | Validação robusta, idempotência, reconciliação; sem circuit breaker |
| Componentes React | **7.0** | Conversas e Contatos bons; Kanban com acessibilidade e design inconsistentes |
| UX / Usabilidade | **6.5** | Fluxos core funcionam; sem auto-scroll, sem live updates, selects sem busca |
| Acessibilidade | **7.5** | Sidebar/Topbar exemplares; modal Kanban falha, drag sem teclado |
| Performance | **7.5** | RPC Kanban eficiente; `getConversationById` é bug de performance e funcionalidade |
| Design Visual | **6.0** | Inconsistência severa entre módulos, tipografia básica, sem Dark Mode |
| Testes | **7.0** | E2E auth excelente; testes de componente são apenas lógica JS |
| Documentação | **9.0** | Completa, honesta, bem estruturada |
| **Média Geral** | **7.8** | |

---

## 14. Recomendação Final

> [!IMPORTANT]
> **Veredicto: Apto com ressalvas. Não recomendado para abertura a usuários reais sem correção dos itens C1, C2 e I1.**

O ImobFlux tem uma **base técnica de qualidade acima da média** para um projeto em `v0.1.0`. Segurança de tenant, RPCs auditadas, pipeline de build verde e documentação honesta são sinais de um projeto que será sustentável no longo prazo.

**Bloqueadores para produção real:**
1. **C1** — `getConversationById` retornará 404 silencioso para workspaces com >100 conversas.
2. **C2** — Webhook aceita POSTs não autenticados se env var não estiver configurada em produção.
3. **I1** — Ausência de auto-scroll no painel de mensagens é a falha de UX mais básica de um app de chat.

**Inconsistência visual** (C3) não impede funcionamento mas causa impacto imediato na percepção de qualidade.

**Próximos passos recomendados para Sprint 19:**
1. Corrigir C1: RPC ou query direta para buscar conversa por ID
2. Corrigir C2: `validateWebhookSecret` deve falhar se env var não configurada
3. Corrigir I1: `useEffect` + `scrollIntoView` ou `scrollTop` para última mensagem
4. Harmonizar visual do Kanban com o design system existente (tokens CSS em vez de classes Tailwind ad hoc)
5. Converter `create-opportunity-dialog.tsx` para usar `<dialog>` nativo
