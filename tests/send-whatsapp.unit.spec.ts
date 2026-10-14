import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import { resolveSendInstance, type ConnectionLookup, type SendConnectionRow } from "../lib/conversations/send-instance";

/* eslint-disable @typescript-eslint/no-require-imports */
const serverSupabaseModule = require("@/lib/supabase/server");
const adminSupabaseModule = require("@/lib/supabase/admin");
// next/cache real exige contexto de requisição; o mesmo stub dos outros testes de ações (antes de carregar as ações).
const nextCachePath = require.resolve("next/cache");
require.cache[nextCachePath] = { id: nextCachePath, filename: nextCachePath, loaded: true, exports: { revalidatePath: () => undefined } } as never;
const nextCacheModule = require("next/cache");
// Instância nova do módulo de ações: outros testes substituem funções do módulo compartilhado e não as devolvem.
delete require.cache[require.resolve("../lib/conversations/actions")];
const actionsModule = require("@/lib/conversations/actions");
const gateway = require("@/lib/supabase/gateway") as typeof import("@/lib/supabase/gateway");
/* eslint-enable @typescript-eslint/no-require-imports */

const sendMessageAction = actionsModule.sendMessageAction as (conversationId: string, text: string, key: string) => Promise<Record<string, unknown>>;

const WORKSPACE = "b6000002-0000-4000-8000-000000000001";
const CONNECTION = "b6000004-0000-4000-8000-000000000001";
const CONVERSATION = "21000000-0000-4000-8000-000000000099";
const KEY = "77000000-0000-4000-8000-000000000001";
const SECRET_KEY = "chave-secreta-da-evolution";
const row = (over: Partial<SendConnectionRow> = {}): SendConnectionRow => ({ id: CONNECTION, workspace_id: WORKSPACE, status: "active", external_account_id: "imobflux-60428201b111", ...over });

function lookup(over: { own?: SendConnectionRow | null; active?: SendConnectionRow | null; ownError?: unknown; activeError?: unknown; throws?: boolean }): ConnectionLookup & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async byId(id) {
      calls.push(`byId:${id}`);
      if (over.throws) throw new Error("boom");
      return { data: over.own ?? null, error: over.ownError ?? null };
    },
    async activeForWorkspace(workspace) {
      calls.push(`active:${workspace}`);
      return { data: over.active ?? null, error: over.activeError ?? null };
    },
  };
}

test.describe("resolveSendInstance: de onde vem a instância do envio", () => {
  test("conexão da conversa ativa: usa a instância gravada no banco, ignorando a variável de ambiente", async () => {
    const result = await resolveSendInstance(lookup({ own: row() }), CONNECTION, { EVOLUTION_INSTANCE_NAME: "instancia-antiga" });
    expect(result).toEqual({ ok: true, instance: "imobflux-60428201b111", source: "connection" });
  });

  test("conexão da conversa foi substituída: usa a conexão ativa do workspace", async () => {
    const l = lookup({ own: row({ status: "replaced", external_account_id: "imobflux-velha" }), active: row({ id: "outra", external_account_id: "imobflux-nova" }) });
    expect(await resolveSendInstance(l, CONNECTION, {})).toEqual({ ok: true, instance: "imobflux-nova", source: "connection" });
    expect(l.calls).toEqual([`byId:${CONNECTION}`, `active:${WORKSPACE}`]);
  });

  test("conexão inexistente ou desativada e sem outra ativa: WHATSAPP_DISCONNECTED (e a reserva do ambiente NÃO é usada)", async () => {
    const env = { EVOLUTION_INSTANCE_NAME: "instancia-reserva" };
    expect(await resolveSendInstance(lookup({ own: null }), CONNECTION, env)).toEqual({ ok: false, code: "WHATSAPP_DISCONNECTED" });
    for (const status of ["disconnected", "configured", "paused", "replaced"]) {
      expect(await resolveSendInstance(lookup({ own: row({ status }), active: null }), CONNECTION, env)).toEqual({ ok: false, code: "WHATSAPP_DISCONNECTED" });
    }
  });

  test("a reserva do ambiente só vale quando o banco não pôde ser consultado", async () => {
    const env = { EVOLUTION_INSTANCE_NAME: " instancia-reserva " };
    const expected = { ok: true, instance: "instancia-reserva", source: "env_fallback" };
    expect(await resolveSendInstance(lookup({ ownError: { code: "XX000" } }), CONNECTION, env)).toEqual(expected);
    expect(await resolveSendInstance(lookup({ throws: true }), CONNECTION, env)).toEqual(expected);
    expect(await resolveSendInstance(lookup({ own: row({ status: "replaced" }), activeError: { code: "XX000" } }), CONNECTION, env)).toEqual(expected);
    expect(await resolveSendInstance(lookup({}), undefined, env)).toEqual(expected);
  });

  test("sem banco e sem reserva: MISSING_INSTANCE", async () => {
    expect(await resolveSendInstance(lookup({ throws: true }), CONNECTION, {})).toEqual({ ok: false, code: "MISSING_INSTANCE" });
    expect(await resolveSendInstance(lookup({}), null, {})).toEqual({ ok: false, code: "MISSING_INSTANCE" });
  });
});

test.describe("sendMessageAction: instância pelo banco, Evolution v2 simulada (sem rede real)", () => {
  // Os valores originais são lidos em cada teste (outros arquivos também trocam estes módulos).
  let original: { server: unknown; admin: unknown; cache: unknown; fetch: typeof fetch };
  const originalEnv = { ...process.env };
  let connections: SendConnectionRow[];
  let queueResult: Record<string, unknown>;
  let reconcileCalls: Array<Record<string, unknown>>;
  let reconcileErrors: Array<{ code?: string } | null>;
  let fetchCalls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }>;
  let evolution: () => Response | Promise<Response>;
  let logged: unknown[][];
  const realError = console.error;

  test.beforeEach(() => {
    original = {
      server: serverSupabaseModule.createServerSupabaseClient,
      admin: adminSupabaseModule.createAdminSupabaseClient,
      cache: nextCacheModule.revalidatePath,
      fetch: globalThis.fetch,
    };
    Object.assign(process.env, { NODE_ENV: "production", EVOLUTION_API_URL: "https://evolution.test", EVOLUTION_API_KEY: SECRET_KEY });
    delete process.env.EVOLUTION_INSTANCE_NAME;
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    connections = [row()];
    queueResult = { status: "queued", message_id: "msg-1", channel_connection_id: CONNECTION, recipient_target: "5582988887000@s.whatsapp.net" };
    reconcileCalls = [];
    reconcileErrors = [];
    fetchCalls = [];
    logged = [];
    evolution = () => new Response(JSON.stringify({ key: { remoteJid: "x", fromMe: true, id: "BAE5-ABC" }, status: "PENDING" }), { status: 201, headers: { "content-type": "application/json" } });
    console.error = (...args: unknown[]) => { logged.push(args); };

    serverSupabaseModule.createServerSupabaseClient = async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
      rpc: async (fn: string) => (fn === "queue_outgoing_text_message" ? { data: queueResult, error: null } : { data: null, error: null }),
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    });
    adminSupabaseModule.createAdminSupabaseClient = () => {
      const query = (filters: Record<string, string>) => ({
        eq: (column: string, value: string) => query({ ...filters, [column]: value }),
        maybeSingle: async () => ({
          data: connections.find((c) => Object.entries(filters).every(([k, v]) => ({ ...c, provider: "whatsapp" } as unknown as Record<string, string>)[k] === v)) ?? null,
          error: null,
        }),
      });
      return {
        from: () => ({ select: () => query({}) }),
        rpc: async (_fn: string, args: Record<string, unknown>) => {
          reconcileCalls.push(args);
          const error = reconcileErrors.shift() ?? null;
          return { data: error ? null : { status: "success" }, error };
        },
      };
    };
    nextCacheModule.revalidatePath = () => undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")), headers: (init?.headers ?? {}) as Record<string, string> });
      return evolution();
    }) as typeof fetch;
  });

  test.afterEach(() => {
    serverSupabaseModule.createServerSupabaseClient = original.server;
    adminSupabaseModule.createAdminSupabaseClient = original.admin;
    nextCacheModule.revalidatePath = original.cache;
    globalThis.fetch = original.fetch;
    console.error = realError;
    process.env = { ...originalEnv };
  });

  const send = () => sendMessageAction(CONVERSATION, "Olá, tudo bem? texto secreto do cliente", KEY);
  const statuses = () => reconcileCalls.map((c) => c.p_target_status);

  test("A. sem EVOLUTION_INSTANCE_NAME (como em produção), envia pela instância da conexão ativa", async () => {
    const result = await send();
    expect(result).toMatchObject({ success: true, status: "sent" });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://evolution.test/message/sendText/imobflux-60428201b111");
  });

  test("C. contrato v2: corpo { number, text }, destino saído do JID e id externo gravado na mensagem", async () => {
    await send();
    expect(fetchCalls[0].body).toEqual({ number: "5582988887000", text: "Olá, tudo bem? texto secreto do cliente" });
    expect(fetchCalls[0].headers.apikey).toBe(SECRET_KEY);
    expect(reconcileCalls).toEqual([{ p_message_id: "msg-1", p_target_status: "sent", p_external_message_id: "BAE5-ABC" }]);
  });

  test("B. conexão desativada no banco: WHATSAPP_DISCONNECTED, nada é enviado e a mensagem fica 'failed'", async () => {
    connections = [row({ status: "disconnected" })];
    const result = await send();
    expect(result).toMatchObject({ success: false, code: "WHATSAPP_DISCONNECTED" });
    expect(String(result.error)).toContain("desconectado");
    expect(fetchCalls).toHaveLength(0);
    expect(statuses()).toEqual(["failed"]);
  });

  test("B. conexão da conversa substituída: sai pela conexão ativa do workspace", async () => {
    connections = [row({ status: "replaced", external_account_id: "imobflux-velha" }), row({ id: "b6000004-0000-4000-8000-000000000002", external_account_id: "imobflux-nova" })];
    await send();
    expect(fetchCalls[0].url).toBe("https://evolution.test/message/sendText/imobflux-nova");
  });

  test("B. conexão inexistente: WHATSAPP_DISCONNECTED (a reserva do ambiente não mascara)", async () => {
    connections = [];
    process.env.EVOLUTION_INSTANCE_NAME = "instancia-reserva";
    expect(await send()).toMatchObject({ success: false, code: "WHATSAPP_DISCONNECTED" });
    expect(fetchCalls).toHaveLength(0);
  });

  test("B. Evolution recusa (400, 401, 500): EVOLUTION_REJECTED com código curto, sem corpo, texto, número ou chave", async () => {
    for (const status of [400, 401, 500]) {
      reconcileCalls = [];
      evolution = () => new Response(JSON.stringify({ message: ["number: 5582988887000 invalid", "Olá, tudo bem? texto secreto do cliente"], apikey: SECRET_KEY }), { status });
      const result = await send();
      expect(result).toMatchObject({ success: false, code: "EVOLUTION_REJECTED" });
      expect(String(result.error)).toContain(`HTTP_${status}`);
      expect(statuses()).toEqual(["failed"]);
      const everything = JSON.stringify([result, logged, reconcileCalls]);
      expect(everything).not.toContain(SECRET_KEY);
      expect(everything).not.toContain("texto secreto do cliente");
      expect(everything).not.toContain("5582988887000");
      expect(everything).not.toContain("evolution.test");
    }
  });

  test("B. timeout e falha de rede têm frases distintas; só o timeout avisa que pode ter saído", async () => {
    evolution = () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
    const timeout = await send();
    expect(timeout).toMatchObject({ success: false, code: "GATEWAY_TIMEOUT" });
    expect(String(timeout.error)).toContain("pode ter sido enviada");
    evolution = () => { throw new Error("connect ECONNREFUSED 10.0.0.9:8080"); };
    const network = await send();
    expect(network).toMatchObject({ success: false, code: "GATEWAY_NETWORK" });
    expect(JSON.stringify([network, logged])).not.toContain("10.0.0.9");
    expect(statuses()).toEqual(["failed", "failed"]);
  });

  test("C. 200 sem id externo não vira 'enviada' silenciosa: falha com aviso de conferir no celular", async () => {
    evolution = () => new Response(JSON.stringify({ status: "PENDING" }), { status: 200 });
    const result = await send();
    expect(result).toMatchObject({ success: false, code: "GATEWAY_ERROR" });
    expect(String(result.error)).toContain("confira no celular");
  });

  test("C. destino inválido (grupo, lista, @lid): INVALID_RECIPIENT, nada vai para a Evolution", async () => {
    for (const target of ["120363000000000001@g.us", "218943875198110@lid", "5582988886001@broadcast"]) {
      queueResult = { ...queueResult, recipient_target: target };
      expect(await send()).toMatchObject({ success: false, code: "INVALID_RECIPIENT" });
    }
    expect(fetchCalls).toHaveLength(0);
  });

  test("reenvio: repetir a mesma chave depois de falha não envia de novo (a tela gera chave nova no clique seguinte)", async () => {
    queueResult = { status: "duplicate", message_id: "msg-1", message_status: "failed" };
    expect(await send()).toMatchObject({ success: false, code: "PREVIOUSLY_FAILED" });
    expect(fetchCalls).toHaveLength(0);
    // chave nova: é outra mensagem, enfileirada de novo
    queueResult = { status: "queued", message_id: "msg-2", channel_connection_id: CONNECTION, recipient_target: "5582988887000@s.whatsapp.net" };
    expect(await sendMessageAction(CONVERSATION, "Olá", "77000000-0000-4000-8000-000000000002")).toMatchObject({ success: true, status: "sent" });
    expect(reconcileCalls.at(-1)).toMatchObject({ p_message_id: "msg-2", p_target_status: "sent" });
  });

  test("corrida com o eco do webhook: id externo já ocupado (23505) não deixa a mensagem 'na fila'", async () => {
    reconcileErrors = [{ code: "23505" }, null];
    const result = await send();
    expect(result).toMatchObject({ success: true, status: "sent" });
    expect(reconcileCalls).toEqual([
      { p_message_id: "msg-1", p_target_status: "sent", p_external_message_id: "BAE5-ABC" },
      { p_message_id: "msg-1", p_target_status: "sent", p_external_message_id: undefined },
    ]);
  });
});

test.describe("gateway v2: respostas da Evolution simuladas", () => {
  const realFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  test.beforeEach(() => { Object.assign(process.env, { EVOLUTION_API_URL: "http://evo.test:8080/", EVOLUTION_API_KEY: SECRET_KEY }); });
  test.afterEach(() => { globalThis.fetch = realFetch; process.env = { ...originalEnv }; });
  const respond = (build: () => Response | Promise<Response>) => { globalThis.fetch = (async () => build()) as typeof fetch; };

  test("201/200 com key.id (e com o envelope data.key.id) devolve o id externo", async () => {
    respond(() => new Response(JSON.stringify({ key: { id: "ID-1" } }), { status: 201 }));
    expect(await gateway.sendEvolutionTextMessage("inst", "5582988880000", "oi")).toEqual({ success: true, externalMessageId: "ID-1" });
    respond(() => new Response(JSON.stringify({ data: { key: { id: "ID-2" } } }), { status: 200 }));
    expect(await gateway.sendEvolutionTextMessage("inst", "5582988880000", "oi")).toEqual({ success: true, externalMessageId: "ID-2" });
  });

  test("400 com campo inválido, 401 e 404: códigos curtos, sem o corpo da resposta", async () => {
    for (const status of [400, 401, 404]) {
      respond(() => new Response(JSON.stringify({ response: { message: ["text must be a string"] }, secret: SECRET_KEY }), { status }));
      const result = await gateway.sendEvolutionTextMessage("inst", "5582988880000", "oi");
      expect(result).toEqual({ success: false, error: `Evolution API retornou erro HTTP ${status}`, code: `HTTP_${status}` });
      expect(JSON.stringify(result)).not.toContain("must be a string");
    }
  });

  test("timeout (AbortError) e rede caída", async () => {
    respond(() => { const e = new Error("x"); e.name = "AbortError"; throw e; });
    expect(await gateway.sendEvolutionTextMessage("inst", "5582988880000", "oi")).toMatchObject({ success: false, code: "TIMEOUT" });
    respond(() => { throw new TypeError("fetch failed"); });
    expect(await gateway.sendEvolutionTextMessage("inst", "5582988880000", "oi")).toMatchObject({ success: false, code: "NETWORK_ERROR" });
  });

  test("resposta que não é JSON ou sem id externo", async () => {
    respond(() => new Response("<html>", { status: 200 }));
    expect(await gateway.sendEvolutionTextMessage("inst", "5582988880000", "oi")).toMatchObject({ success: false, code: "INVALID_JSON_RESPONSE" });
    respond(() => new Response(JSON.stringify({ key: {} }), { status: 201 }));
    expect(await gateway.sendEvolutionTextMessage("inst", "5582988880000", "oi")).toMatchObject({ success: false, code: "MISSING_EXTERNAL_ID" });
  });
});

test.describe("formatPhoneForEvolution: destino a partir do JID e do telefone digitado", () => {
  const f = gateway.formatPhoneForEvolution;

  test("JID brasileiro com 9º dígito, sem o 9 (celular antigo) e com sufixo de dispositivo", () => {
    expect(f("5582988887000@s.whatsapp.net")).toBe("5582988887000");
    expect(f("558288887000@s.whatsapp.net")).toBe("558288887000");
    expect(f("5582988887000:12@s.whatsapp.net")).toBe("5582988887000");
    expect(f("5582988887000@c.us")).toBe("5582988887000");
  });

  test("JID internacional de 10/11 dígitos NÃO ganha o 55 (o JID já traz o país)", () => {
    expect(f("14155550123@s.whatsapp.net")).toBe("14155550123");
    expect(f("447911123456@s.whatsapp.net")).toBe("447911123456");
  });

  test("grupo, lista, canal, @lid e lixo não são destino individual", () => {
    for (const jid of ["120363000000000001@g.us", "5582988886001@broadcast", "status@broadcast", "1203@newsletter", "218943875198110@lid", "@s.whatsapp.net", "abc@s.whatsapp.net", "0123456789@s.whatsapp.net", "123@s.whatsapp.net"]) {
      expect(f(jid)).toBeNull();
    }
  });

  test("telefone digitado continua com as regras antigas (DDI 55, 10/11 dígitos)", () => {
    expect(f("(82) 98888-7000")).toBe("5582988887000");
    expect(f("82 8888-7000")).toBe("558288887000");
    expect(f("+55 82 98888-7000")).toBe("5582988887000");
    expect(f("988887000")).toBeNull();
    expect(f("")).toBeNull();
  });
});
