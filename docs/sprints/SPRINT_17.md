# Relatório da Sprint 17 — Server Action & Integração Textual WhatsApp

- **Sprint**: Sprint 17
- **Objetivo**: Implementar o fluxo de integração textual do WhatsApp no CRM, cobrindo o envio via CRM (Server Action `sendMessageAction`), gateway HTTP desacoplado (`sendEvolutionTextMessage`), webhook de ingestão da Evolution API (`ingest_whatsapp_text_message`) e a UI de envio no painel de conversa (`MessageForm`).
- **Data de Conclusão**: 2026-08-04
- **Status**: `CONCLUÍDO`

---

## Escopo Executado

1. **RPCs de Banco de Dados (`20260802001400_add_whatsapp_integration_rpcs.sql`)**:
   - `queue_outgoing_text_message`: Fila atômica de saída com verificação de idempotência por `client_idempotency_key`. Trata casos de duplicidade com retornos de status `sent`, `queued` e `failed`.
   - `reconcile_outgoing_text_message`: Transição idempotente do status da mensagem enviada (`sent` ou `failed`), impedindo atualizações conflitantes.
   - `ingest_whatsapp_text_message`: Ingestão atômica de mensagens recebidas via webhook da Evolution API, resolvendo ou criando contatos e conversas por workspace.

2. **Server Action & Gateway HTTP (`lib/conversations/actions.ts` e `lib/supabase/gateway.ts`)**:
   - `sendMessageAction`: Server Action autenticada para validação de tamanho de mensagem (até 4096 caracteres), envio atômico via RPC, invocação do gateway HTTP Evolution API e reconciliação imediata com `revalidatePath('/conversas/${conversationId}')`.
   - Gateway HTTP: Comunicação com a Evolution API via `POST /message/sendText/{instance}`, injetando a chave de API e tratando time-outs e respostas de erro sem vazar segredos SQL.

3. **Webhook Handler (`app/api/webhooks/whatsapp/route.ts` & `lib/conversations/webhook.ts`)**:
   - Route handler validando segredo `x-evolution-secret`, parseando payloads de texto, ignorando mensagens de grupo (`@g.us`) e chamando `ingest_whatsapp_text_message`.

4. **Interface de Envio (`components/conversations/message-form.tsx`)**:
   - Componente de envio com validação de campo não vazio, envio por `Enter`, nova linha por `Shift + Enter`, limite de 4096 caracteres, contador discreto próximo do limite (>= 3500) e desabilitação durante pending.

---

## Arquivos Criados / Alterados

- `supabase/migrations/20260802001400_add_whatsapp_integration_rpcs.sql` [NEW]
- `lib/conversations/actions.ts` [NEW]
- `lib/conversations/webhook.ts` [NEW]
- `lib/supabase/gateway.ts` [NEW]
- `app/api/webhooks/whatsapp/route.ts` [NEW]
- `components/conversations/message-form.tsx` [NEW]
- `components/conversations/messages-panel.tsx` [MODIFY]
- `supabase/tests/database/whatsapp_integration.test.sql` [NEW]
- `tests/webhook.unit.spec.ts` [NEW]
- `tests/gateway.unit.spec.ts` [NEW]
- `tests/actions.unit.spec.ts` [NEW]
- `tests/message-form.unit.spec.ts` [NEW]
- `tests/whatsapp-integration.e2e.spec.ts` [NEW]

---

## Testes & Validações

- **pgTAP SQL**: `whatsapp_integration.test.sql` cobrindo ingestão, enfileiramento, idempotência e isolamento RLS.
- **Playwright Unit & E2E**: 60 testes específicos cobrindo tratamento de webhooks, gateway HTTP, Server Action e formulário de envio `MessageForm`.
- **Lint & Build**: Aprovados com 0 erros.

---

## Limitações

- Conexão real com o QR Code da Evolution API ainda não configurada no ambiente.
- Suporte a mídias e anexos não incluído nesta sprint (apenas texto).
- Sem atualização via Supabase Realtime nesta etapa.

---

## Resultado & Próxima Etapa

A Sprint 17 foi entregue e validada com 100% dos testes aprovados. A aplicação avançou para a Sprint 18 (Kanban Comercial).
