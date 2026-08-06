// Bypass do marker 'server-only' para ambiente Node de testes
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
const gatewayModule = require("@/lib/supabase/gateway");
const formatPhoneForEvolution = gatewayModule.formatPhoneForEvolution;
const sendEvolutionTextMessage = gatewayModule.sendEvolutionTextMessage;

const realFetch = globalThis.fetch;

test.describe("Evolution API Gateway Unit Tests", () => {
  const originalEnv = { ...process.env };

  test.beforeEach(() => {
    globalThis.fetch = realFetch;
    Object.assign(process.env, {
      EVOLUTION_API_URL: "http://localhost:8080",
      EVOLUTION_API_KEY: "secret_key_123",
      EVOLUTION_INSTANCE_NAME: "instance_test_99",
    });
  });

  test.afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...originalEnv };
  });

  test("1. formatPhoneForEvolution formata corretamente telefones de variados formatos", () => {
    expect(formatPhoneForEvolution("+55 (82) 98888-0000")).toBe("5582988880000");
    expect(formatPhoneForEvolution("5582988880000")).toBe("5582988880000");
    expect(formatPhoneForEvolution("82988880000")).toBe("5582988880000");
    expect(formatPhoneForEvolution("988880000")).toBeNull();
    expect(formatPhoneForEvolution("   +55 82 98888 0000   ")).toBe(
      "5582988880000",
    );
    expect(formatPhoneForEvolution("123")).toBeNull();
    expect(formatPhoneForEvolution("abc")).toBeNull();
  });

  test("2. lança erro interno ao chamar gateway sem EVOLUTION_API_URL ou EVOLUTION_API_KEY", async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;

    const res = await sendEvolutionTextMessage(
      "instancia",
      "5582988880000",
      "mensagem",
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("MISSING_ENV_CONFIG");
    expect(res.error).toBe("Configuração da Evolution API ausente no ambiente");
  });

  test("3. lança erro ao chamar gateway sem instância definida", async () => {
    delete process.env.EVOLUTION_INSTANCE_NAME;

    const res = await sendEvolutionTextMessage(
      "",
      "5582988880000",
      "mensagem",
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("MISSING_INSTANCE");
    expect(res.error).toBe("Nome da instância do WhatsApp não informado");
  });

  test("4. rejeita telefone inválido sem realizar requisição HTTP", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}");
    };

    const res = await sendEvolutionTextMessage(
      "instancia",
      "telefone-invalido",
      "mensagem",
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("INVALID_PHONE");
    expect(fetchCalled).toBe(false);
  });

  test("5. monta URL, headers e payload corretos conforme contrato Evolution v2", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = input.toString();
      capturedMethod = init?.method || "";
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      capturedBody = JSON.parse((init?.body as string) || "{}");

      return new Response(
        JSON.stringify({
          key: { id: "ext_msg_999" },
        }),
        { status: 200 },
      );
    };

    const res = await sendEvolutionTextMessage(
      "instancia_teste",
      "+55 (82) 98888-0000",
      "Mensagem de teste de contrato",
    );

    expect(res.success).toBe(true);
    expect(res.externalMessageId).toBe("ext_msg_999");

    expect(capturedUrl).toBe(
      "http://localhost:8080/message/sendText/instancia_teste",
    );
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders.apikey).toBe("secret_key_123");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");

    expect(capturedBody).toEqual({
      number: "5582988880000",
      textMessage: {
        text: "Mensagem de teste de contrato",
      },
    });
  });

  test("6. HTTP 503 / erro do servidor gera GATEWAY_ERROR", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: "Service Unavailable" }), {
        status: 503,
      });
    };

    const res = await sendEvolutionTextMessage(
      "instancia",
      "5582988880000",
      "mensagem",
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("HTTP_503");
    expect(res.error).toBe("Evolution API retornou erro HTTP 503");
  });

  test("7. timeout/abort gera TIMEOUT", async () => {
    globalThis.fetch = async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    };

    const res = await sendEvolutionTextMessage(
      "instancia",
      "5582988880000",
      "mensagem",
      100,
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("TIMEOUT");
    expect(res.error).toBe("Tempo limite excedido no envio da mensagem");
  });

  test("8. nenhuma chave privada ou segredo é exposto na resposta de erro", async () => {
    globalThis.fetch = async () => {
      throw new Error("Fatal connection refused to http://internal:8080");
    };

    const res = await sendEvolutionTextMessage(
      "instancia",
      "5582988880000",
      "mensagem",
    );

    expect(res.success).toBe(false);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain("secret_key_123");
    expect(serialized).not.toContain("http://internal:8080");
  });
});
