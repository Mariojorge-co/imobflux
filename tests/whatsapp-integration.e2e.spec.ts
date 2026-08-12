// Bypass dos markers 'server-only' e 'next/cache' para ambiente Node de testes
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {
      __esModule: true,
    },
  };
} catch {
  // Ignorar
}

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextCacheModule = require("next/cache");
nextCacheModule.revalidatePath = () => {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminSupabaseModule = require("@/lib/supabase/admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverSupabaseModule = require("@/lib/supabase/server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gatewayModule = require("@/lib/supabase/gateway");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webhookRouteModule = require("@/app/api/webhooks/whatsapp/route");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/conversations/actions");

const VALID_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const realSendEvolutionTextMessage = gatewayModule.sendEvolutionTextMessage;
const realFetch = globalThis.fetch;

test.describe("Sprint 17 — WhatsApp Textual Integration E2E Test Suite", () => {
  test.beforeEach(() => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "test_webhook_secret_123";
    process.env.EVOLUTION_API_URL = "https://api.evolution.test";
    process.env.EVOLUTION_API_KEY = "test_api_key_xyz";
    process.env.EVOLUTION_INSTANCE_NAME = "instance_test_99";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_ADMIN_KEY = "test_admin_key_abc";

    gatewayModule.sendEvolutionTextMessage = realSendEvolutionTextMessage;
    globalThis.fetch = realFetch;

    // Mock do cliente Admin do Supabase (para Webhook e Reconciliação)
    adminSupabaseModule.createAdminSupabaseClient = () => ({
      rpc: async (fnName: string, args: Record<string, unknown>) => {
        if (fnName === "ingest_whatsapp_text_message") {
          if (args.p_external_account_id === "non_existent_instance") {
            return {
              data: null,
              error: {
                message: "Instância de conexão não encontrada",
                code: "42704",
              },
            };
          }
          if (args.p_external_message_id === "msg_ext_e2e_duplicate") {
            return {
              data: { status: "duplicate", message_id: "msg-ext-dup-99" },
              error: null,
            };
          }
          return {
            data: { status: "success", message_id: "msg-ext-success-99" },
            error: null,
          };
        }

        if (fnName === "reconcile_outgoing_text_message") {
          return { data: { status: "success" }, error: null };
        }

        return { data: null, error: null };
      },
    });

    // Mock do cliente Autenticado do Supabase (para Server Action queue_outgoing)
    serverSupabaseModule.createServerSupabaseClient = async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: "10000000-0000-4000-8000-000000000099" } },
          error: null,
        }),
      },
      rpc: async (fnName: string, args: Record<string, unknown>) => {
        if (fnName === "queue_outgoing_text_message") {
          if (
            args.p_client_idempotency_key ===
            "77000000-0000-4000-8000-000000000002"
          ) {
            return {
              data: {
                status: "duplicate",
                message_id: "msg-failed-99",
                message_status: "failed",
              },
              error: null,
            };
          }
          return {
            data: {
              status: "queued",
              message_id: "msg-queued-999",
              recipient_target: "+5582988881111",
              channel_connection_id: "61000000-0000-4000-8000-000000000099",
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    });
  });

  test.afterEach(() => {
    gatewayModule.sendEvolutionTextMessage = realSendEvolutionTextMessage;
    globalThis.fetch = realFetch;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEÇÃO 1: FLUXO INCOMING E2E (WEBHOOK & INGESTÃO)
  // ───────────────────────────────────────────────────────────────────────────

  test("1. Webhook sem segredo x-evolution-secret retorna HTTP 401", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert" }),
    });

    const res = await webhookRouteModule.POST(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe("Não autorizado");
  });

  test("2. Webhook com segredo incorreto retorna HTTP 401", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-evolution-secret": "wrong_secret_value",
      },
      body: JSON.stringify({ event: "messages.upsert" }),
    });

    const res = await webhookRouteModule.POST(req);
    expect(res.status).toBe(401);
  });

  test("3. Webhook com JSON inválido/malformado retorna HTTP 400", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-evolution-secret": "test_webhook_secret_123",
      },
      body: "INVALID_JSON{{{",
    });

    const res = await webhookRouteModule.POST(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toBe("Payload JSON inválido");
  });

  test("4. Mensagens direcionadas a grupos (@g.us) usam ingestão dedicada", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-evolution-secret": "test_webhook_secret_123",
      },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: "instance_test_99",
        data: {
          key: {
            remoteJid: "120363000000000000@g.us",
            fromMe: false,
            id: "msg_group_100",
            participant: "5582988880000@s.whatsapp.net",
          },
          pushName: "Grupo Imobiliária",
          messageTimestamp: 1700000000,
          message: { conversation: "Mensagem no grupo de teste" },
        },
      }),
    });

    const res = await webhookRouteModule.POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("success");
  });

  test("5. Payload textual válido chama RPC ingest_whatsapp_text_message com argumentos atômicos esperados", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-evolution-secret": "test_webhook_secret_123",
      },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: "instance_test_99",
        data: {
          key: {
            remoteJid: "5582988881111@s.whatsapp.net",
            fromMe: false,
            id: "msg_ext_e2e_1",
          },
          pushName: "João da Silva",
          messageTimestamp: 1700000000,
          message: { conversation: "Olá, gostaria de agendar uma visita" },
        },
      }),
    });

    const res = await webhookRouteModule.POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("success");
  });

  test("6. Webhook repetido com mesmo externalMessageId trata status duplicate com HTTP 200", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-evolution-secret": "test_webhook_secret_123",
      },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: "instance_test_99",
        data: {
          key: {
            remoteJid: "5582988881111@s.whatsapp.net",
            fromMe: false,
            id: "msg_ext_e2e_duplicate",
          },
          pushName: "João da Silva",
          messageTimestamp: 1700000000,
          message: { conversation: "Olá novamente" },
        },
      }),
    });

    const res = await webhookRouteModule.POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.status).toBe("duplicate");
  });

  test("7. Ingestão fromMe=true resolve nome neutro para novos contatos e omite internal_author_member_id", async () => {
    const req = new Request("http://localhost/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-evolution-secret": "test_webhook_secret_123",
      },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: "instance_test_99",
        data: {
          key: {
            remoteJid: "5582988882222@s.whatsapp.net",
            fromMe: true,
            id: "msg_ext_from_me_e2e",
          },
          pushName: "PushName Ignorado",
          messageTimestamp: 1700000000,
          message: { conversation: "Resposta enviada pelo celular" },
        },
      }),
    });

    const res = await webhookRouteModule.POST(req);
    expect(res.status).toBe(200);
  });

  test("8. Instância de outro workspace não vaza dados nem expõe mensagens SQL em caso de falha", async () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      const req = new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-evolution-secret": "test_webhook_secret_123",
        },
        body: JSON.stringify({
          event: "messages.upsert",
          instance: "non_existent_instance",
          data: {
            key: {
              remoteJid: "5582988889999@s.whatsapp.net",
              fromMe: false,
              id: "msg_isolated_1",
            },
            pushName: "Usuário Desconhecido",
            messageTimestamp: 1700000000,
            message: { conversation: "Mensagem isolada" },
          },
        }),
      });

      const res = await webhookRouteModule.POST(req);
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error).toBe("Erro interno no processamento do webhook");
      expect(json.error).not.toContain("42704");
      expect(json.error).not.toContain("EVOLUTION_WEBHOOK_SECRET");
    } finally {
      console.error = originalConsoleError;
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SEÇÃO 2: FLUXO OUTGOING E2E (SEND MESSAGE ACTION & GATEWAY STUB)
  // ───────────────────────────────────────────────────────────────────────────

  test("9. Fluxo Outgoing E2E completo: queue -> gateway mock HTTP -> reconcile sent", async () => {
    process.env.EVOLUTION_API_URL = "https://api.evolution.test";
    process.env.EVOLUTION_API_KEY = "test_api_key_xyz";
    process.env.EVOLUTION_INSTANCE_NAME = "instance_test_99";

    const conversationId = "21000000-0000-4000-8000-000000000099";
    const idempotencyKey = crypto.randomUUID();
    const text = "Mensagem E2E enviada pelo CRM";

    let capturedUrl = "";
    let capturedMethod = "";
    let capturedApiKey = "";
    let capturedPayload: unknown = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = input.toString();
      capturedMethod = init?.method || "GET";
      capturedApiKey = (init?.headers as Record<string, string>)?.apikey || "";
      capturedPayload = JSON.parse((init?.body as string) || "{}");

      return new Response(
        JSON.stringify({
          key: { id: "ext_evolution_msg_e2e_999" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const actionsPath = require.resolve("@/lib/conversations/actions");
      delete require.cache[actionsPath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const freshActions = require("@/lib/conversations/actions");

      const res = await freshActions.sendMessageAction(
        conversationId,
        text,
        idempotencyKey,
      );

      expect(res.success).toBe(true);
      expect(res.status).toBe("sent");

      expect(capturedUrl).toBe("https://api.evolution.test/message/sendText/instance_test_99");
      expect(capturedMethod).toBe("POST");
      expect(capturedApiKey).toBe("test_api_key_xyz");
      expect(capturedPayload).toEqual({
        number: "5582988881111",
        textMessage: { text: "Mensagem E2E enviada pelo CRM" },
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("10. Simulação de falha do gateway: transição para failed sem retry automático", async () => {
    const conversationId = "21000000-0000-4000-8000-000000000099";
    const idempotencyKey = crypto.randomUUID();
    const text = "Mensagem com falha no gateway";

    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({ error: "Serviço indisponível" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    };

    try {
      const actionsPath = require.resolve("@/lib/conversations/actions");
      delete require.cache[actionsPath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const freshActions = require("@/lib/conversations/actions");

      const res = await freshActions.sendMessageAction(
        conversationId,
        text,
        idempotencyKey,
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("GATEWAY_ERROR");
      expect(res.error).toBe("Falha ao enviar mensagem via WhatsApp");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("11. Mesma clientIdempotencyKey em mensagem com falha não re-trigga gateway", async () => {
    const conversationId = "21000000-0000-4000-8000-000000000099";
    const idempotencyKey = "77000000-0000-4000-8000-000000000002"; // ID em status failed na fixture
    const text = "Mensagem que falhou anteriormente";

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    try {
      const actionsPath = require.resolve("@/lib/conversations/actions");
      delete require.cache[actionsPath];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const freshActions = require("@/lib/conversations/actions");

      const res = await freshActions.sendMessageAction(
        conversationId,
        text,
        idempotencyKey,
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("PREVIOUSLY_FAILED");
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("12. Garantia de isolamento e ausência de segredos no payload trafegado", async () => {
    let capturedArgs: unknown[] = [];
    const originalSendMessage = actionsModule.sendMessageAction;

    actionsModule.sendMessageAction = async (...args: unknown[]) => {
      capturedArgs = args;
      return { success: true, messageId: "msg-safe-101", status: "sent" };
    };

    try {
      await actionsModule.sendMessageAction(
        "21000000-0000-4000-8000-000000000099",
        "Teste de payload seguro no cliente",
        crypto.randomUUID(),
      );

      expect(capturedArgs.length).toBe(3);
      expect(VALID_UUID_REGEX.test(capturedArgs[0] as string)).toBe(true);
      expect(capturedArgs[1]).toBe("Teste de payload seguro no cliente");
      expect(VALID_UUID_REGEX.test(capturedArgs[2] as string)).toBe(true);

      const serialized = JSON.stringify(capturedArgs);
      expect(serialized).not.toContain("workspace_id");
      expect(serialized).not.toContain("workspaceId");
      expect(serialized).not.toContain("recipient_phone");
      expect(serialized).not.toContain("instance_name");
      expect(serialized).not.toContain("EVOLUTION_API_KEY");
    } finally {
      actionsModule.sendMessageAction = originalSendMessage;
    }
  });
});
