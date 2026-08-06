// Bypass do marker 'server-only' e 'next/cache' para ambiente Node de testes
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };
} catch {
  // Ignorar se não resolvido
}

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverSupabaseModule = require("@/lib/supabase/server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminSupabaseModule = require("@/lib/supabase/admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gatewayModule = require("@/lib/supabase/gateway");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextCacheModule = require("next/cache");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/conversations/actions");
const sendMessageAction = actionsModule.sendMessageAction;

const originalCreateServerSupabaseClient = serverSupabaseModule.createServerSupabaseClient;
const originalCreateAdminSupabaseClient = adminSupabaseModule.createAdminSupabaseClient;
const originalSendEvolutionTextMessage = gatewayModule.sendEvolutionTextMessage;

const VALID_CONVERSATION_ID = "21000000-0000-4000-8000-000000000099";
const VALID_IDEMPOTENCY_KEY = "77000000-0000-4000-8000-000000000001";

test.describe("Server Action sendMessageAction Unit Tests", () => {
  let authUserResult: { data: unknown; error: unknown } = {
    data: { user: { id: "user-123" } },
    error: null,
  };
  let queueRpcResult: { data: unknown; error: unknown } = {
    data: {
      status: "queued",
      message_id: "msg-uuid-999",
      recipient_target: "+5582999990099",
    },
    error: null,
  };
  let gatewayResult: { success: boolean; externalMessageId?: string; error?: string; code?: string } = {
    success: true,
    externalMessageId: "ext-msg-123",
  };
  let reconcileCalls: Array<{ fnName: string; args: Record<string, unknown> }> = [];
  let reconcileRpcResult: { data: unknown; error: unknown } = {
    data: { status: "success" },
    error: null,
  };
  let revalidatedPaths: string[] = [];
  let gatewayCalledCount = 0;

  test.beforeEach(() => {
    Object.assign(process.env, {
      EVOLUTION_API_URL: "http://localhost:8080",
      EVOLUTION_API_KEY: "secret_key_123",
      EVOLUTION_INSTANCE_NAME: "instance_test_99",
    });

    authUserResult = {
      data: { user: { id: "user-123" } },
      error: null,
    };
    queueRpcResult = {
      data: {
        status: "queued",
        message_id: "msg-uuid-999",
        recipient_target: "+5582999990099",
      },
      error: null,
    };
    gatewayResult = {
      success: true,
      externalMessageId: "ext-msg-123",
    };
    reconcileCalls = [];
    reconcileRpcResult = {
      data: { status: "success" },
      error: null,
    };
    revalidatedPaths = [];
    gatewayCalledCount = 0;

    // Mock do client autenticado
    serverSupabaseModule.createServerSupabaseClient = async () => {
      return {
        auth: {
          getUser: async () => authUserResult,
        },
        rpc: async (fnName: string) => {
          if (fnName === "queue_outgoing_text_message") {
            return queueRpcResult;
          }
          return { data: null, error: null };
        },
      };
    };

    // Mock do client admin
    adminSupabaseModule.createAdminSupabaseClient = () => {
      return {
        rpc: async (fnName: string, args: Record<string, unknown>) => {
          reconcileCalls.push({ fnName, args });
          return reconcileRpcResult;
        },
      };
    };

    // Mock do gateway
    gatewayModule.sendEvolutionTextMessage = async () => {
      gatewayCalledCount++;
      return gatewayResult;
    };

    // Mock do revalidatePath
    nextCacheModule.revalidatePath = (path: string) => {
      revalidatedPaths.push(path);
    };
  });

  test.afterEach(() => {
    serverSupabaseModule.createServerSupabaseClient = originalCreateServerSupabaseClient;
    adminSupabaseModule.createAdminSupabaseClient = originalCreateAdminSupabaseClient;
    gatewayModule.sendEvolutionTextMessage = originalSendEvolutionTextMessage;
  });

  test("1. sessão não autenticada/expirada retorna erro UNAUTHORIZED", async () => {
    authUserResult = { data: null, error: { message: "No session" } };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Sessão expirada ou não autenticada",
      code: "UNAUTHORIZED",
    });
  });

  test("2. conversationId inválido retorna erro INVALID_CONVERSATION_ID", async () => {
    const res = await sendMessageAction(
      "invalid-uuid",
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "ID da conversa inválido",
      code: "INVALID_CONVERSATION_ID",
    });
  });

  test("3. clientIdempotencyKey inválida retorna erro INVALID_IDEMPOTENCY_KEY", async () => {
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      "invalid-uuid",
    );

    expect(res).toEqual({
      success: false,
      error: "Chave de idempotência inválida",
      code: "INVALID_IDEMPOTENCY_KEY",
    });
  });

  test("4. conteúdo vazio retorna erro EMPTY_TEXT", async () => {
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "   ",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Conteúdo da mensagem não pode ser vazio",
      code: "EMPTY_TEXT",
    });
  });

  test("5. conteúdo excedendo 4096 caracteres retorna erro TEXT_TOO_LONG", async () => {
    const longText = "a".repeat(4097);
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      longText,
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error:
        "Conteúdo da mensagem excede o limite máximo permitido de 4096 caracteres",
      code: "TEXT_TOO_LONG",
    });
  });

  test("6. falha ao enfileirar via RPC retorna erro QUEUE_ERROR", async () => {
    queueRpcResult = { data: null, error: { message: "DB Error" } };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Erro ao enfileirar mensagem de saída",
      code: "QUEUE_ERROR",
    });
  });

  test("7. duplicate com status sent retorna sucesso idempotente sem chamar gateway", async () => {
    queueRpcResult = {
      data: {
        status: "duplicate",
        message_id: "msg-uuid-999",
        message_status: "sent",
      },
      error: null,
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: true,
      messageId: "msg-uuid-999",
      status: "duplicate",
    });
    expect(gatewayCalledCount).toBe(0);
    expect(revalidateCalls.length).toBe(0);
    expect(revalidatedPaths).toContain(`/conversas/${VALID_CONVERSATION_ID}`);
  });

  test("8. duplicate com status queued retorna sucesso idempotente em fila", async () => {
    queueRpcResult = {
      data: {
        status: "duplicate",
        message_id: "msg-uuid-999",
        message_status: "queued",
      },
      error: null,
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: true,
      messageId: "msg-uuid-999",
      status: "duplicate",
    });
    expect(gatewayCalledCount).toBe(0);
    expect(revalidatedPaths).toContain(`/conversas/${VALID_CONVERSATION_ID}`);
  });

  test("9. duplicate com status failed indica erro anterior sem retry automático", async () => {
    queueRpcResult = {
      data: {
        status: "duplicate",
        message_id: "msg-uuid-999",
        message_status: "failed",
      },
      error: null,
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Esta mensagem falhou em uma tentativa anterior de envio.",
      code: "PREVIOUSLY_FAILED",
    });
    expect(gatewayCalledCount).toBe(0);
  });

  test("10. fluxo com sucesso no gateway chama reconcile com sent e revalida o caminho", async () => {
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: true,
      messageId: "msg-uuid-999",
      status: "sent",
    });
    expect(gatewayCalledCount).toBe(1);
    expect(reconcileCalls.length).toBe(1);
    expect(reconcileCalls[0]).toEqual({
      fnName: "reconcile_outgoing_text_message",
      args: {
        p_message_id: "msg-uuid-999",
        p_target_status: "sent",
        p_external_message_id: "ext-msg-123",
      },
    });
    expect(revalidatedPaths).toContain(`/conversas/${VALID_CONVERSATION_ID}`);
  });

  test("11. fluxo com falha no gateway chama reconcile com failed, revalida e omite segredos", async () => {
    gatewayResult = {
      success: false,
      error: "HTTP 500",
      code: "HTTP_500",
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Falha ao enviar mensagem via WhatsApp",
      code: "GATEWAY_ERROR",
    });
    expect(gatewayCalledCount).toBe(1);
    expect(reconcileCalls.length).toBe(1);
    expect(reconcileCalls[0]).toEqual({
      fnName: "reconcile_outgoing_text_message",
      args: {
        p_message_id: "msg-uuid-999",
        p_target_status: "failed",
        p_external_message_id: undefined,
      },
    });
    expect(revalidatedPaths).toContain(`/conversas/${VALID_CONVERSATION_ID}`);
  });
});

const revalidateCalls: unknown[] = [];
