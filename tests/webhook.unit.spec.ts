// 1. Bypass do marker 'server-only' para execução em ambiente Node de testes
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };
} catch {
  // Ignorar se não puder ser resolvido
}

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminModule = require("@/lib/supabase/admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routeModule = require("@/app/api/webhooks/whatsapp/route");
const POST = routeModule.POST;

const originalCreateAdminSupabaseClient = adminModule.createAdminSupabaseClient;

// Helper para construir requisições HTTP mockadas
function createMockRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
}) {
  const headers = new Headers(options.headers ?? {});
  let bodyContent: string | undefined;

  if (options.rawBody !== undefined) {
    bodyContent = options.rawBody;
  } else if (options.body !== undefined) {
    bodyContent = JSON.stringify(options.body);
  }

  return new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: options.method ?? "POST",
    headers,
    body: bodyContent,
  });
}

test.describe("Evolution API Webhook Route Handler & Parser Complete Unit Tests", () => {
  const originalEnv = process.env;
  let rpcCalls: Array<{ fnName: string; args: Record<string, unknown> }> = [];
  let rpcMockResult: { data: unknown; error: unknown } = {
    data: { status: "success", message_id: "msg-uuid-123" },
    error: null,
  };

  test.beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.EVOLUTION_WEBHOOK_SECRET = "secret_token_123";
    process.env.SUPABASE_ADMIN_KEY = "admin_key_secret";

    rpcCalls = [];
    rpcMockResult = {
      data: { status: "success", message_id: "msg-uuid-123" },
      error: null,
    };

    // Mock do client administrativo Supabase
    adminModule.createAdminSupabaseClient = () => {
      return {
        rpc: async (fnName: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fnName, args });
          return rpcMockResult;
        },
      };
    };
  });

  test.afterEach(() => {
    process.env = originalEnv;
    rpcMockResult = {
      data: { status: "success", message_id: "msg-uuid-123" },
      error: null,
    };
    adminModule.createAdminSupabaseClient = originalCreateAdminSupabaseClient;
  });

  // 1. POST sem segredo retorna 401
  test("1. POST sem segredo retorna 401 Unauthorized", async () => {
    const req = createMockRequest({
      headers: {},
      body: { event: "messages.upsert", instance: "inst-1", data: {} },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Não autorizado");
  });

  // 2. POST com segredo incorreto retorna 401
  test("2. POST com segredo incorreto retorna 401 Unauthorized", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "wrong_secret" },
      body: { event: "messages.upsert", instance: "inst-1", data: {} },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Não autorizado");
  });

  // 3. JSON inválido retorna 400
  test("3. JSON inválido retorna 400 Bad Request", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      rawBody: "invalid_json{{{",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Payload JSON inválido");
  });

  // 4. Evento desconhecido retorna 200 sem chamar RPC
  test("4. evento desconhecido retorna HTTP 200 sem chamar RPC", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: { event: "connection.update", instance: "inst-1", data: {} },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ignored");
    expect(json.reason).toBe("unhandled_event");
    expect(rpcCalls.length).toBe(0);
  });

  // 5. Grupo (@g.us) retorna 200 sem chamar RPC
  test("5. mensagem de grupo (@g.us) retorna HTTP 200 sem chamar RPC", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "inst-1",
        data: {
          key: {
            remoteJid: "120363041999999999@g.us",
            fromMe: false,
            id: "msg-1",
          },
          pushName: "Grupo Imobiliária",
          messageTimestamp: 1700000000,
          message: { conversation: "Olá grupo" },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ignored");
    expect(json.reason).toBe("group_event_ignored");
    expect(rpcCalls.length).toBe(0);
  });

  // 6. Mensagem não textual (imagem/mídia) retorna 200 sem chamar RPC
  test("6. mensagem não textual (imagem) retorna HTTP 200 sem chamar RPC", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "inst-1",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-img-1",
          },
          pushName: "João",
          messageTimestamp: 1700000000,
          message: { imageMessage: { caption: "Foto da casa" } },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ignored");
    expect(json.reason).toBe("non_text_message_ignored");
    expect(rpcCalls.length).toBe(0);
  });

  // 7. Payload textual válido chama RPC ingest_whatsapp_text_message com argumentos esperados
  test("7. payload textual válido chama ingest_whatsapp_text_message com argumentos esperados", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "instancia_mario",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-ext-777",
          },
          pushName: "Mario Jorge",
          messageTimestamp: 1700000000,
          message: { conversation: "Olá, tenho interesse no imóvel." },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.message_id).toBe("msg-uuid-123");

    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0]).toEqual({
      fnName: "ingest_whatsapp_text_message",
      args: {
        p_external_account_id: "instancia_mario",
        p_remote_jid: "5582988880000@s.whatsapp.net",
        p_from_me: false,
        p_external_message_id: "msg-ext-777",
        p_push_name: "Mario Jorge",
        p_occurred_at: "2023-11-14T22:13:20.000Z",
        p_text_content: "Olá, tenho interesse no imóvel.",
      },
    });
  });

  // 8. Resultado duplicate da RPC é tratado como sucesso HTTP 200
  test("8. resultado duplicate da RPC é tratado como sucesso HTTP 200", async () => {
    rpcMockResult = {
      data: { status: "duplicate", message_id: "msg-uuid-123" },
      error: null,
    };

    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "instancia_mario",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-ext-777",
          },
          pushName: "Mario Jorge",
          messageTimestamp: 1700000000,
          message: { conversation: "Mensagem repetida" },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("duplicate");
    expect(json.message_id).toBe("msg-uuid-123");
  });

  // 9. Erro de RPC/instância inexistente retorna HTTP 500 sem detalhes SQL
  test("9. erro de RPC/instância inexistente retorna HTTP 500 sem detalhes SQL", async () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      rpcMockResult = {
        data: null,
        error: {
          message: "Conexão de canal não encontrada para a instância",
          code: "42704",
        },
      };

      const req = createMockRequest({
        headers: { "x-evolution-secret": "secret_token_123" },
        body: {
          event: "messages.upsert",
          instance: "instancia_desconhecida",
          data: {
            key: {
              remoteJid: "5582988880000@s.whatsapp.net",
              fromMe: false,
              id: "msg-ext-999",
            },
            pushName: "Desconhecido",
            messageTimestamp: 1700000000,
            message: { conversation: "Olá" },
          },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Erro interno no processamento do webhook");
      expect(json.error).not.toContain("42704");
      expect(json.error).not.toContain("Conexão de canal");
    } finally {
      console.error = originalConsoleError;
    }
  });

  // 10. Nenhuma resposta de erro ou sucesso expõe segredos ou chaves internas
  test("10. nenhuma resposta de erro ou sucesso expõe segredos ou chaves internas", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "inst-1",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-ext-1",
          },
          pushName: "Teste Segredos",
          messageTimestamp: 1700000000,
          message: { conversation: "Teste" },
        },
      },
    });

    const res = await POST(req);
    const text = await res.text();

    expect(text).not.toContain("secret_token_123");
    expect(text).not.toContain("admin_key_secret");
  });

  // 11. Validação de métodos HTTP suportados
  test("11. validação de métodos HTTP suportados pelo Route Handler", async () => {
    const req = createMockRequest({
      method: "GET",
      headers: { "x-evolution-secret": "secret_token_123" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
