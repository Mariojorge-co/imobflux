# Relatório da Sprint 16 — Módulo Interno de Conversas (Base Funcional)

## 1. Objetivo
Construir a estrutura e o modelo de leitura interno para o módulo de Conversas (`/conversas`), conectando a interface ao banco de dados PostgreSQL local sem depender de integrações externas com WhatsApp ou Supabase Realtime neste estágio.

## 2. Escopo
- Criar a migration `20260802001200_add_conversations_read_model.sql` com a RPC `get_conversations_list`.
- Implementar paginação estável baseada em cursor `(last_activity_at DESC, conversation_id DESC)`.
- Implementar busca por nome do contato, telefone normalizado ou nome do participante externo.
- Desenvolver a camada de dados server-side `lib/conversations/data.ts` (`server-only`) e Server Actions `lib/conversations/actions.ts`.
- Criar o layout responsivo de duas colunas em `app/(app)/conversas/layout.tsx` e rotas `/conversas` e `/conversas/[conversationId]`.
- Implementar os componentes `ConversationsList` e `MessagesPanel` com suporte a histórico cronológico, separadores por data e aviso explicativo de "Somente leitura".

## 3. Arquivos Criados
- `supabase/migrations/20260802001200_add_conversations_read_model.sql`
- `supabase/tests/database/conversations_read_model.test.sql`
- `lib/conversations/data.ts`
- `lib/conversations/actions.ts`
- `app/(app)/conversas/layout.tsx`
- `app/(app)/conversas/[conversationId]/page.tsx`
- `components/conversations/conversations-list.tsx`
- `components/conversations/messages-panel.tsx`
- `tests/conversations.spec.ts`

## 4. Arquivos Alterados
- `app/(app)/conversas/page.tsx`
- `types/database.ts` (regenerado)

## 5. Migrations
- `20260802001200_add_conversations_read_model.sql`: Define a RPC `public.get_conversations_list` e configura grants restritos à role `authenticated`.

## 6. RPCs Criadas
- `get_conversations_list(p_search, p_cursor_ts, p_cursor_id, p_limit)`:
  - **Tipo**: `SECURITY INVOKER`
  - **Parâmetros**: Busca opcional, cursores de timestamp e UUID, limite (clamped entre 1 e 100, default 20).
  - **Desempenho**: Utiliza `LATERAL JOIN` para obter a mensagem mais recente por conversa em consulta única.
  - **Segurança**: Sem `workspace_id` nos parâmetros; RLS das tabelas filtra automaticamente o workspace do usuário logado.

## 7. Testes
- **pgTAP SQL** (`conversations_read_model.test.sql`): 21 asserções SQL cobrindo SECURITY INVOKER, grants, isolamento de tenant, ordenação por atividade, busca por nome/telefone e negação para `anon`. (Integrado à suíte total de 240 asserções SQL em 5 arquivos).
- **Playwright E2E** (`conversations.spec.ts`): Suíte E2E cobrindo login, listagem, busca reativa, deep link direto, visualização de mensagens e comportamento mobile.

## 8. Validações Executadas
- `supabase test db` → **PASS** (5 arquivos, 240 asserções SQL).
- `npm run lint` → **PASS** (0 erros, 0 warnings).
- `npm run build` → **PASS** (Next.js App Router).
- `npm run test:auth` → **PASS** (43 testes no total: 38 executados e aprovados; 5 ignorados/skipped por guarda condicional de banco limpo sem cards prévios no Playwright).

## 9. Decisões Arquiteturais
- **Postergador do Supabase Realtime**: Supabase Realtime foi intencionalmente adiado para a sprint de integração com o WhatsApp.
- **Navegação por Rota Dinâmica**: Adotada a estrutura `/conversas/[conversationId]` permitindo deep links diretos com suporte a botão "Voltar" no mobile.
- **SECURITY INVOKER na RPC**: Garantido que a RPC executa no contexto do chamador, respeitando RLS e impedindo vazamento multi-tenant.

## 10. Limitações
- Módulo operando exclusivamente em modo **somente leitura** (sem campo de envio ativo para mensagens).
- Metadados de anexos exibem "Anexo indisponível" sem expor `storage_key` ou links de download inseguros.

## 11. Resultado
Módulo de conversas totalmente funcional no banco local com busca, paginação, segurança por RLS e layout responsivo.

## 12. Próxima Etapa
Sprint 17 — Integração Externa do WhatsApp (Conexão e Webhooks).
