import "./helpers/server-only";

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const evo = require("@/lib/whatsapp/evolution-instance") as typeof import("@/lib/whatsapp/evolution-instance");

const ENV = { EVOLUTION_API_URL: "http://evolution.test:8080/", EVOLUTION_API_KEY: "key-123" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
function recorder(responses: Array<Response | (() => Response | Promise<Response>)>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> });
    const next = responses[Math.min(i++, responses.length - 1)];
    return typeof next === "function" ? next() : next;
  }) as unknown as typeof fetch;
  return { calls, options: { env: ENV, fetchImpl, timeoutMs: 80 } };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test.describe("parseQr", () => {
  test("aceita a imagem do QR com ou sem prefixo e devolve sempre um data URL de imagem", () => {
    expect(evo.parseQr({ base64: PNG, code: "2@abc" })).toEqual({ image: PNG, code: "2@abc" });
    expect(evo.parseQr({ base64: PNG.split(",")[1] })).toEqual({ image: PNG, code: null });
  });

  test("rejeita qualquer conteúdo que não seja imagem base64 (nada de HTML/SVG/URL)", () => {
    for (const base64 of ["", "   ", "<script>alert(1)</script>", "data:text/html;base64,PHNjcmlwdD4=", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "http://evil.test/x.png", `${PNG}"onerror="x`, "A".repeat(250_000)]) {
      expect(evo.parseQr({ base64 })).toBeNull();
    }
    expect(evo.parseQr(null)).toBeNull();
    expect(evo.parseQr({ base64: 123 })).toBeNull();
  });
});

test.describe("createInstance", () => {
  test("cria a instância com o corpo e a apikey do contrato v2 e devolve o QR da criação", async () => {
    const { calls, options } = recorder([json({ instance: { instanceName: "imobflux-1", status: "connecting" }, qrcode: { base64: PNG, code: "2@abc", count: 1 } }, 201)]);
    const result = await evo.createInstance("imobflux-1", options);
    expect(result).toEqual({ ok: true, data: { created: true, qr: { image: PNG, code: "2@abc" } } });
    expect(calls[0].url).toBe("http://evolution.test:8080/instance/create");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.apikey).toBe("key-123");
    expect(calls[0].body).toEqual({ instanceName: "imobflux-1", qrcode: true, integration: "WHATSAPP-BAILEYS" });
  });

  test("403 'already in use' (instância existente) não é erro", async () => {
    const { options } = recorder([json({ status: 403, error: "Forbidden", response: { message: ['This name "imobflux-1" is already in use.'] } }, 403)]);
    expect(await evo.createInstance("imobflux-1", options)).toEqual({ ok: true, data: { created: false, qr: null } });
  });

  test("falhas viram códigos: 401, 500, sem configuração, rede e timeout", async () => {
    expect(await evo.createInstance("x", recorder([json({}, 401)]).options)).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(await evo.createInstance("x", recorder([json({}, 500)]).options)).toEqual({ ok: false, code: "HTTP_ERROR" });
    expect(await evo.createInstance("x", { env: {} })).toEqual({ ok: false, code: "NOT_CONFIGURED" });
    expect(await evo.createInstance("x", { env: { EVOLUTION_API_URL: "http://x" } })).toEqual({ ok: false, code: "NOT_CONFIGURED" });
    expect(await evo.createInstance("x", recorder([() => { throw new TypeError("fetch failed"); }]).options)).toEqual({ ok: false, code: "NETWORK_ERROR" });
    const hang = recorder([() => new Promise<Response>(() => undefined)]);
    // o AbortController precisa rejeitar a promise pendente
    const hangingFetch = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    expect(await evo.createInstance("x", { ...hang.options, fetchImpl: hangingFetch })).toEqual({ ok: false, code: "TIMEOUT" });
  });
});

test.describe("connect, estado e número", () => {
  test("connect devolve o QR novo; sem QR (já conectada) devolve null", async () => {
    const withQr = recorder([json({ pairingCode: null, code: "2@x", base64: PNG, count: 2 })]);
    expect(await evo.connectInstance("imobflux-1", withQr.options)).toEqual({ ok: true, data: { qr: { image: PNG, code: "2@x" } } });
    expect(withQr.calls[0].url).toBe("http://evolution.test:8080/instance/connect/imobflux-1");
    expect(withQr.calls[0].method).toBe("GET");
    expect(await evo.connectInstance("x", recorder([json({ instance: { state: "open" } })]).options)).toEqual({ ok: true, data: { qr: null } });
    expect(await evo.connectInstance("nao-existe", recorder([json({}, 404)]).options)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  test("estado: formato v2 (instance.state) e formato plano, normalizados", async () => {
    expect(await evo.getInstanceState("x", recorder([json({ instance: { instanceName: "x", state: "open" } })]).options)).toEqual({ ok: true, data: "open" });
    expect(await evo.getInstanceState("x", recorder([json({ state: "connecting" })]).options)).toEqual({ ok: true, data: "connecting" });
    expect(await evo.getInstanceState("x", recorder([json({ instance: { state: "close" } })]).options)).toEqual({ ok: true, data: "close" });
    expect(await evo.getInstanceState("x", recorder([json({ nada: 1 })]).options)).toEqual({ ok: false, code: "INVALID_RESPONSE" });
    expect(await evo.getInstanceState("x", recorder([json({ status: 404, error: "Not Found" }, 404)]).options)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  test("número a partir do ownerJid (com sufixo de dispositivo) ou do campo number; null enquanto não pareou", async () => {
    const paired = recorder([json([{ name: "x", connectionStatus: "open", ownerJid: "5582999990000:7@s.whatsapp.net", number: null }])]);
    expect(await evo.getInstanceNumber("imobflux-1", paired.options)).toEqual({ ok: true, data: "+5582999990000" });
    expect(paired.calls[0].url).toBe("http://evolution.test:8080/instance/fetchInstances?instanceName=imobflux-1");
    expect(await evo.getInstanceNumber("x", recorder([json([{ name: "x", ownerJid: null, number: "5582988880000" }])]).options)).toEqual({ ok: true, data: "+5582988880000" });
    expect(await evo.getInstanceNumber("x", recorder([json([{ name: "x", connectionStatus: "connecting", ownerJid: null, number: null }])]).options)).toEqual({ ok: true, data: null });
    expect(await evo.getInstanceNumber("x", recorder([json([])]).options)).toEqual({ ok: false, code: "INVALID_RESPONSE" });
  });
});

test.describe("webhook e logout", () => {
  test("configura o webhook com o envelope v2, o segredo no header e os dois eventos", async () => {
    const { calls, options } = recorder([json({ enabled: true }, 201)]);
    expect(await evo.setInstanceWebhook("imobflux-1", { url: "https://app.test/api/webhooks/whatsapp", secret: "s3cret" }, options)).toEqual({ ok: true, data: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://evolution.test:8080/webhook/set/imobflux-1");
    expect(calls[0].body).toEqual({
      webhook: {
        enabled: true,
        url: "https://app.test/api/webhooks/whatsapp",
        byEvents: false,
        base64: false,
        headers: { "x-evolution-secret": "s3cret" },
        events: ["MESSAGES_UPSERT", "MESSAGES_EDITED", "MESSAGES_DELETE", "CONNECTION_UPDATE", "MESSAGES_SET"],
      },
    });
  });

  test("se a versão rejeitar o envelope (400), tenta o corpo plano", async () => {
    const { calls, options } = recorder([json({ error: "Bad Request" }, 400), json({ enabled: true }, 201)]);
    expect(await evo.setInstanceWebhook("x", { url: "https://app.test/w", secret: "s" }, options)).toEqual({ ok: true, data: true });
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { url?: string }).url).toBe("https://app.test/w");
    expect((calls[1].body as { webhook?: unknown }).webhook).toBeUndefined();
  });

  test("falha do webhook é reportada", async () => {
    expect(await evo.setInstanceWebhook("x", { url: "u", secret: "s" }, recorder([json({}, 500)]).options)).toEqual({ ok: false, code: "HTTP_ERROR" });
  });

  test("logout encerra a sessão; instância inexistente vira NOT_FOUND", async () => {
    const ok = recorder([json({ status: "SUCCESS", error: false, response: { message: "Instance logged out" } })]);
    expect(await evo.logoutInstance("imobflux-1", ok.options)).toEqual({ ok: true, data: true });
    expect(ok.calls[0]).toMatchObject({ method: "DELETE", url: "http://evolution.test:8080/instance/logout/imobflux-1" });
    expect(await evo.logoutInstance("x", recorder([json({}, 404)]).options)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  test("nome da instância é codificado na URL (sem injeção de caminho)", async () => {
    const { calls, options } = recorder([json({ instance: { state: "open" } })]);
    await evo.getInstanceState("../admin?x=1", options);
    expect(calls[0].url).toBe("http://evolution.test:8080/instance/connectionState/..%2Fadmin%3Fx%3D1");
  });
});

test("isEvolutionConfigured exige URL e chave", () => {
  expect(evo.isEvolutionConfigured(ENV)).toBe(true);
  expect(evo.isEvolutionConfigured({ EVOLUTION_API_URL: "http://x" })).toBe(false);
  expect(evo.isEvolutionConfigured({ EVOLUTION_API_KEY: "k", EVOLUTION_API_URL: "  " })).toBe(false);
  expect(evo.isEvolutionConfigured({})).toBe(false);
});

test.describe("eventos do webhook (edição e exclusão feitas no celular)", () => {
  test("a assinatura inclui MESSAGES_EDITED e MESSAGES_DELETE, com ou sem histórico", () => {
    expect(evo.webhookEvents(true)).toEqual(["MESSAGES_UPSERT", "MESSAGES_EDITED", "MESSAGES_DELETE", "CONNECTION_UPDATE", "MESSAGES_SET"]);
    expect(evo.webhookEvents(false)).toEqual(["MESSAGES_UPSERT", "MESSAGES_EDITED", "MESSAGES_DELETE", "CONNECTION_UPDATE"]);
  });

  test("conexões antigas (só upsert/set/connection) acusam o que falta; maiúsculas e separadores não importam", () => {
    expect(evo.missingWebhookEvents(["MESSAGES_UPSERT", "MESSAGES_SET", "CONNECTION_UPDATE"])).toEqual(["MESSAGES_EDITED", "MESSAGES_DELETE"]);
    expect(evo.missingWebhookEvents(["messages.upsert", "messages.edited", "messages-delete", "connection.update"])).toEqual([]);
  });

  test("GET /webhook/find devolve os eventos (envelope plano ou aninhado); sem eles, nulo; instância inexistente é NOT_FOUND", async () => {
    const flat = recorder([json({ enabled: true, events: ["MESSAGES_UPSERT"] })]);
    expect(await evo.getInstanceWebhookEvents("imobflux-1", flat.options)).toEqual({ ok: true, data: ["MESSAGES_UPSERT"] });
    expect(flat.calls[0].url).toBe("http://evolution.test:8080/webhook/find/imobflux-1");
    expect(flat.calls[0].method).toBe("GET");
    expect(await evo.getInstanceWebhookEvents("x", recorder([json({ webhook: { events: ["A", 3, "B"] } })]).options)).toEqual({ ok: true, data: ["A", "B"] });
    expect(await evo.getInstanceWebhookEvents("x", recorder([json({ enabled: false })]).options)).toEqual({ ok: true, data: null });
    expect(await evo.getInstanceWebhookEvents("x", recorder([json({}, 404)]).options)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});
