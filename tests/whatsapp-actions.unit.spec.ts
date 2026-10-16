import "./helpers/server-only";

import { expect, test } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-require-imports */
function stubModule(name: string, exports: object) {
  const path = require.resolve(name);
  require.cache[path] = { id: path, filename: path, loaded: true, exports } as never;
}
let requestHeaders = new Headers();
stubModule("next/headers", { cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => requestHeaders });

const dal = require("@/lib/auth/dal");
const serverModule = require("@/lib/supabase/server");
const evolution = require("@/lib/whatsapp/evolution-instance");
const security = require("@/lib/auth/security");
const actions = require("@/app/(app)/configuracoes/whatsapp/actions") as typeof import("@/app/(app)/configuracoes/whatsapp/actions");
/* eslint-enable @typescript-eslint/no-require-imports */

const original = {
  access: dal.getOptionalActiveAccess,
  server: serverModule.createServerSupabaseClient,
  evo: { ...evolution },
};
const QR = { image: "data:image/png;base64,AAAA", code: "2@abc" };
const WORKSPACE = "8ad043dd-3b0f-4e3f-a14b-9ae303df7fe2";
const INSTANCE = "imobflux-8ad043dd3b0f";

let access: { role: string; workspaceId: string } | null;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
let rpcResults: Record<string, { data?: unknown; error?: { code?: string } | null }>;
let evoCalls: string[];
let evoResults: Record<string, unknown>;
let connectionRows: Array<Record<string, unknown>>;
let rpcSequence: Record<string, Array<{ data?: unknown; error?: { code?: string } | null }>>;

function stubEvolution() {
  const record = (name: string, args?: unknown) => { evoCalls.push(args === undefined ? name : `${name}:${JSON.stringify(args)}`); return evoResults[name]; };
  evolution.isEvolutionConfigured = () => evoResults.configured !== false;
  evolution.createInstance = async (n: string) => record("createInstance", n);
  evolution.setInstanceWebhook = async (n: string, c: unknown) => record("setInstanceWebhook", [n, c]);
  evolution.getInstanceState = async (n: string) => record("getInstanceState", n);
  evolution.connectInstance = async (n: string) => record("connectInstance", n);
  evolution.getInstanceNumber = async (n: string) => record("getInstanceNumber", n);
  evolution.logoutInstance = async (n: string) => record("logoutInstance", n);
}

test.beforeEach(() => {
  process.env.EVOLUTION_API_URL = "http://evo.test";
  process.env.EVOLUTION_API_KEY = "k";
  process.env.EVOLUTION_WEBHOOK_SECRET = "segredo-do-webhook";
  delete process.env.WHATSAPP_WEBHOOK_BASE_URL;
  requestHeaders = new Headers({ origin: "https://imobflux.test", host: "imobflux.test", "x-forwarded-host": "imobflux.test", "x-forwarded-proto": "https" });
  access = { role: "owner", workspaceId: WORKSPACE };
  rpcCalls = [];
  rpcResults = {};
  rpcSequence = {};
  connectionRows = [];
  evoCalls = [];
  evoResults = {
    createInstance: { ok: true, data: { created: true, qr: QR } },
    setInstanceWebhook: { ok: true, data: true },
    getInstanceState: { ok: true, data: "connecting" },
    connectInstance: { ok: true, data: { qr: QR } },
    getInstanceNumber: { ok: true, data: "+5582999990000" },
    logoutInstance: { ok: true, data: true },
  };
  dal.getOptionalActiveAccess = async () => access;
  serverModule.createServerSupabaseClient = async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const queued = rpcSequence[fn]?.shift();
      return queued ?? rpcResults[fn] ?? { data: { status: "success" }, error: null };
    },
    from: (table: string) => ({ select: () => ({ eq: async () => ({ data: table === "channel_connections" ? connectionRows : [], error: null }) }) }),
  });
  stubEvolution();
});

test.afterEach(() => {
  dal.getOptionalActiveAccess = original.access;
  serverModule.createServerSupabaseClient = original.server;
  Object.assign(evolution, original.evo);
});

test.describe("autorização", () => {
  test("somente o OWNER ativo: ATTENDANT e sem sessão são recusados antes de qualquer chamada", async () => {
    for (const who of [{ role: "attendant", workspaceId: WORKSPACE }, null]) {
      access = who;
      for (const result of [await actions.startWhatsappConnectionAction(), await actions.refreshWhatsappConnectionAction(false), await actions.disconnectWhatsappAction()]) {
        expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
      }
    }
    expect(rpcCalls).toHaveLength(0);
    expect(evoCalls).toHaveLength(0);
  });

  test("origem não confiável (CSRF) é recusada antes de qualquer chamada", async () => {
    // A checagem em si tem testes próprios; aqui garantimos que cada ação a respeita.
    const originalCheck = security.assertTrustedServerActionOrigin;
    security.assertTrustedServerActionOrigin = async () => { throw new Error("Origem da operação não permitida."); };
    try {
      for (const result of [await actions.startWhatsappConnectionAction(), await actions.refreshWhatsappConnectionAction(false), await actions.disconnectWhatsappAction()]) {
        expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
      }
    } finally {
      security.assertTrustedServerActionOrigin = originalCheck;
    }
    expect(rpcCalls).toHaveLength(0);
    expect(evoCalls).toHaveLength(0);
  });
});

test.describe("startWhatsappConnectionAction", () => {
  test("fluxo completo: registra a conexão, cria a instância, aponta o webhook e devolve o QR", async () => {
    const result = await actions.startWhatsappConnectionAction();
    expect(result).toEqual({ ok: true, state: "connecting", qr: QR, phone: null });
    expect(rpcCalls).toEqual([{ fn: "register_whatsapp_channel", args: { p_instance_name: INSTANCE } }]);
    expect(evoCalls).toEqual([
      `createInstance:"${INSTANCE}"`,
      `setInstanceWebhook:${JSON.stringify([INSTANCE, { url: "https://imobflux.test/api/webhooks/whatsapp", secret: "segredo-do-webhook", includeHistory: true }])}`,
      `getInstanceState:"${INSTANCE}"`,
    ]); // o QR veio da criação: não precisa pedir de novo
  });

  test("instância já existente: pede um QR novo", async () => {
    evoResults.createInstance = { ok: true, data: { created: false, qr: null } };
    const result = await actions.startWhatsappConnectionAction();
    expect(result).toEqual({ ok: true, state: "connecting", qr: QR, phone: null });
    expect(evoCalls).toContain(`connectInstance:"${INSTANCE}"`);
  });

  test("já conectada no WhatsApp: ativa com o número e não pede QR", async () => {
    evoResults.getInstanceState = { ok: true, data: "open" };
    const result = await actions.startWhatsappConnectionAction();
    expect(result).toEqual({ ok: true, state: "open", qr: null, phone: "+5582999990000" });
    expect(rpcCalls.map((c) => c.fn)).toEqual(["register_whatsapp_channel", "confirm_whatsapp_channel_state"]);
    expect(rpcCalls[1].args).toEqual({ p_instance_name: INSTANCE, p_state: "open", p_phone: "+5582999990000" });
    expect(evoCalls.some((c) => c.startsWith("connectInstance"))).toBe(false);
  });

  test("sem o número ainda: continua 'connecting' (não ativa sem número)", async () => {
    evoResults.getInstanceState = { ok: true, data: "open" };
    evoResults.getInstanceNumber = { ok: true, data: null };
    rpcResults.confirm_whatsapp_channel_state = { data: { status: "ignored", reason: "phone_required" }, error: null };
    expect(await actions.startWhatsappConnectionAction()).toEqual({ ok: true, state: "connecting", qr: null, phone: null });
    expect(rpcCalls[1].args).toEqual({ p_instance_name: INSTANCE, p_state: "open" });
  });

  test("ambiente sem Evolution, sem segredo ou com endereço local: erro claro e nada é chamado", async () => {
    evoResults.configured = false;
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    evoResults.configured = true;

    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "WEBHOOK_SECRET_MISSING" });
    process.env.EVOLUTION_WEBHOOK_SECRET = "s";

    requestHeaders = new Headers({ origin: "http://localhost:3000", host: "localhost:3000" });
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "WEBHOOK_UNREACHABLE" });
    expect(rpcCalls).toHaveLength(0);
    expect(evoCalls).toHaveLength(0);
  });

  test("WHATSAPP_WEBHOOK_BASE_URL permite ambiente local com Evolution em Docker", async () => {
    process.env.WHATSAPP_WEBHOOK_BASE_URL = "http://host.docker.internal:3100";
    requestHeaders = new Headers({ origin: "http://localhost:3100", host: "localhost:3100" });
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: true });
    expect(evoCalls.find((c) => c.startsWith("setInstanceWebhook"))).toContain("http://host.docker.internal:3100/api/webhooks/whatsapp");
  });

  test("falhas da Evolution viram mensagens amigáveis em cada etapa", async () => {
    evoResults.createInstance = { ok: false, code: "NETWORK_ERROR" };
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "EVOLUTION_UNREACHABLE" });

    evoResults.createInstance = { ok: false, code: "UNAUTHORIZED" };
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "EVOLUTION_REJECTED" });

    evoResults.createInstance = { ok: true, data: { created: true, qr: QR } };
    evoResults.setInstanceWebhook = { ok: false, code: "HTTP_ERROR" };
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "EVOLUTION_UNREACHABLE" });

    evoResults.setInstanceWebhook = { ok: true, data: true };
    evoResults.getInstanceState = { ok: false, code: "TIMEOUT" };
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "EVOLUTION_UNREACHABLE" });
  });

  test("erro ao registrar no banco: FORBIDDEN (sem permissão) ou DATABASE; nenhuma chamada à Evolution", async () => {
    rpcResults.register_whatsapp_channel = { data: null, error: { code: "42501" } };
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    rpcResults.register_whatsapp_channel = { data: null, error: { code: "XX000" } };
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "DATABASE" });
    expect(evoCalls).toHaveLength(0);
  });

  test("exceção inesperada não vaza: vira erro genérico", async () => {
    evolution.createInstance = async () => { throw new Error("boom"); };
    expect(await actions.startWhatsappConnectionAction()).toMatchObject({ ok: false, code: "EVOLUTION_UNREACHABLE" });
  });
});

test.describe("refreshWhatsappConnectionAction", () => {
  test("conectada: confirma no banco com o número", async () => {
    evoResults.getInstanceState = { ok: true, data: "open" };
    expect(await actions.refreshWhatsappConnectionAction(false)).toEqual({ ok: true, state: "open", qr: null, phone: "+5582999990000" });
    expect(rpcCalls).toEqual([{ fn: "confirm_whatsapp_channel_state", args: { p_instance_name: INSTANCE, p_state: "open", p_phone: "+5582999990000" } }]);
  });

  test("aguardando leitura: só devolve QR novo quando pedido", async () => {
    expect(await actions.refreshWhatsappConnectionAction(false)).toEqual({ ok: true, state: "connecting", qr: null, phone: null });
    expect(evoCalls.some((c) => c.startsWith("connectInstance"))).toBe(false);
    expect(await actions.refreshWhatsappConnectionAction(true)).toEqual({ ok: true, state: "connecting", qr: QR, phone: null });
  });

  test("encerrada (ex.: desconectada pelo celular): alinha o banco para 'close'", async () => {
    evoResults.getInstanceState = { ok: true, data: "close" };
    expect(await actions.refreshWhatsappConnectionAction(false)).toEqual({ ok: true, state: "close", qr: null, phone: null });
    expect(rpcCalls).toEqual([{ fn: "confirm_whatsapp_channel_state", args: { p_instance_name: INSTANCE, p_state: "close" } }]);
  });

  test("instância inexistente na Evolution equivale a 'close' e tolera conexão ainda não registrada", async () => {
    evoResults.getInstanceState = { ok: false, code: "NOT_FOUND" };
    rpcResults.confirm_whatsapp_channel_state = { data: null, error: { code: "P0002" } };
    expect(await actions.refreshWhatsappConnectionAction(false)).toEqual({ ok: true, state: "close", qr: null, phone: null });
  });

  test("Evolution fora do ar: erro; banco com falha: DATABASE", async () => {
    evoResults.getInstanceState = { ok: false, code: "NETWORK_ERROR" };
    expect(await actions.refreshWhatsappConnectionAction(false)).toMatchObject({ ok: false, code: "EVOLUTION_UNREACHABLE" });
    evoResults.getInstanceState = { ok: true, data: "open" };
    rpcResults.confirm_whatsapp_channel_state = { data: null, error: { code: "XX000" } };
    expect(await actions.refreshWhatsappConnectionAction(false)).toMatchObject({ ok: false, code: "DATABASE" });
  });
});

test.describe("disconnectWhatsappAction", () => {
  test("faz logout na Evolution e marca como desconectada", async () => {
    expect(await actions.disconnectWhatsappAction()).toEqual({ ok: true, state: "close", qr: null, phone: null });
    expect(evoCalls).toEqual([`logoutInstance:"${INSTANCE}"`]);
    expect(rpcCalls).toEqual([{ fn: "confirm_whatsapp_channel_state", args: { p_instance_name: INSTANCE, p_state: "close" } }]);
  });

  test("instância já inexistente ou conexão nunca registrada não impedem desconectar", async () => {
    evoResults.logoutInstance = { ok: false, code: "NOT_FOUND" };
    rpcResults.confirm_whatsapp_channel_state = { data: null, error: { code: "P0002" } };
    expect(await actions.disconnectWhatsappAction()).toMatchObject({ ok: true, state: "close" });
  });

  test("falha real do logout NÃO marca como desconectada no banco", async () => {
    evoResults.logoutInstance = { ok: false, code: "NETWORK_ERROR" };
    expect(await actions.disconnectWhatsappAction()).toMatchObject({ ok: false, code: "EVOLUTION_UNREACHABLE" });
    expect(rpcCalls).toHaveLength(0);
  });
});

test.describe("histórico zero na conexão", () => {
  test("janela 0 no registro: a Evolution é configurada SEM assinar o histórico", async () => {
    rpcResults.register_whatsapp_channel = { data: { status: "success", history_window_days: 0 }, error: null };
    await actions.startWhatsappConnectionAction();
    const hook = evoCalls.find((call) => call.startsWith("setInstanceWebhook"));
    expect(hook).toContain('"includeHistory":false');
  });

  test("janela 15 (ou sem a informação): assina o histórico como antes", async () => {
    rpcResults.register_whatsapp_channel = { data: { status: "success", history_window_days: 15 }, error: null };
    await actions.startWhatsappConnectionAction();
    expect(evoCalls.find((call) => call.startsWith("setInstanceWebhook"))).toContain('"includeHistory":true');
  });
});

test.describe("saveWhatsappIngestSettingsAction", () => {
  test("só o OWNER ativo; ATTENDANT e sem sessão são recusados antes de qualquer chamada", async () => {
    for (const who of [{ role: "attendant", workspaceId: WORKSPACE }, null]) {
      access = who;
      expect(await actions.saveWhatsappIngestSettingsAction({ onlyKnownContacts: true })).toMatchObject({ ok: false });
    }
    expect(rpcCalls).toHaveLength(0);
  });

  test("origem não confiável (CSRF) é recusada antes de qualquer chamada", async () => {
    const originalCheck = security.assertTrustedServerActionOrigin;
    security.assertTrustedServerActionOrigin = async () => { throw new Error("Origem da operação não permitida."); };
    try {
      expect(await actions.saveWhatsappIngestSettingsAction({ ingestGroups: true })).toMatchObject({ ok: false });
    } finally {
      security.assertTrustedServerActionOrigin = originalCheck;
    }
    expect(rpcCalls).toHaveLength(0);
  });

  test("valores inválidos são recusados sem chamar o banco", async () => {
    for (const input of [{ ingestGroups: "sim" }, { onlyKnownContacts: 1 }, { historyWindowDays: 16 }, { historyWindowDays: -1 }, { historyWindowDays: 1.5 }]) {
      expect(await actions.saveWhatsappIngestSettingsAction(input as never)).toEqual({ ok: false, error: "Valor inválido para esta configuração." });
    }
    expect(rpcCalls).toHaveLength(0);
  });

  test("envia só as chaves informadas e devolve as configurações lidas do banco", async () => {
    connectionRows = [{ status: "configured", created_at: "2026-10-13", history_window_days: 0, ingest_groups: false, ingest_only_known_contacts: true, ignored_counts: { unknown_contact: 4 } }];
    const result = await actions.saveWhatsappIngestSettingsAction({ onlyKnownContacts: true });
    expect(rpcCalls).toEqual([{ fn: "update_whatsapp_ingest_settings", args: { p_only_known_contacts: true } }]);
    expect(result).toEqual({
      ok: true,
      connectionStatus: "configured",
      settings: { ingestGroups: false, onlyKnownContacts: true, historyWindowDays: 0, ignored: { groups: 0, unknownContacts: 4, invalidPhones: 0 } },
    });
  });

  test("sem conexão ainda: registra (só no banco, sem falar com a Evolution) e tenta de novo", async () => {
    rpcSequence.update_whatsapp_ingest_settings = [{ data: null, error: { code: "P0002" } }];
    connectionRows = [{ status: "configured", created_at: "2026-10-13", history_window_days: 15, ingest_groups: true }];
    const result = await actions.saveWhatsappIngestSettingsAction({ ingestGroups: true });
    expect(rpcCalls.map((call) => call.fn)).toEqual(["update_whatsapp_ingest_settings", "register_whatsapp_channel", "update_whatsapp_ingest_settings"]);
    expect(rpcCalls[1].args).toEqual({ p_instance_name: INSTANCE });
    expect(result).toMatchObject({ ok: true });
    expect(evoCalls).toHaveLength(0);
  });

  test("mensagens claras: janela trancada depois do pareamento, sem permissão e erro de banco", async () => {
    rpcResults.update_whatsapp_ingest_settings = { data: null, error: { code: "55000" } };
    expect(await actions.saveWhatsappIngestSettingsAction({ historyWindowDays: 0 })).toEqual({
      ok: false,
      error: "O histórico só pode ser escolhido antes de conectar o número. Desconecte e conecte de novo para mudar.",
    });
    rpcResults.update_whatsapp_ingest_settings = { data: null, error: { code: "42501" } };
    expect(await actions.saveWhatsappIngestSettingsAction({ ingestGroups: true })).toMatchObject({ ok: false, error: expect.stringContaining("proprietário") });
    rpcResults.update_whatsapp_ingest_settings = { data: null, error: { code: "XX000" } };
    expect(await actions.saveWhatsappIngestSettingsAction({ ingestGroups: true })).toEqual({ ok: false, error: "Não foi possível salvar agora. Tente novamente." });
  });
});

test.describe("avisos de edição e exclusão (webhook)", () => {
  function stubConnectionRows(rows: Array<Record<string, unknown>>) {
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order"]) chain[name] = () => chain;
    chain.limit = async () => ({ data: rows, error: null });
    serverModule.createServerSupabaseClient = async () => ({ rpc: async () => ({ data: null, error: null }), from: () => chain });
  }

  test("só o OWNER consulta ou reaplica; atendente e sem sessão são recusados sem falar com a Evolution", async () => {
    for (const who of [{ role: "attendant", workspaceId: WORKSPACE }, null]) {
      access = who;
      expect(await actions.getWhatsappWebhookStatusAction()).toMatchObject({ ok: false });
      expect(await actions.updateWhatsappWebhookEventsAction()).toMatchObject({ ok: false });
    }
    expect(evoCalls).toHaveLength(0);
  });

  test("conexão antiga (sem edição/exclusão): mostra o que falta; reaplicar assina todos os eventos e confirma", async () => {
    evolution.getInstanceWebhookEvents = async (n: string) => {
      evoCalls.push(`getInstanceWebhookEvents:${n}`);
      return { ok: true, data: evoCalls.filter((c) => c.startsWith("setInstanceWebhook")).length === 0 ? ["MESSAGES_UPSERT", "MESSAGES_SET", "CONNECTION_UPDATE"] : ["MESSAGES_UPSERT", "MESSAGES_EDITED", "MESSAGES_DELETE", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "MESSAGES_SET"] };
    };
    const before = await actions.getWhatsappWebhookStatusAction();
    expect(before).toEqual({ ok: true, connected: true, active: false, missing: ["MESSAGES_EDITED", "MESSAGES_DELETE", "MESSAGES_UPDATE"] });
    stubConnectionRows([{ history_window_days: 7 }]);
    const after = await actions.updateWhatsappWebhookEventsAction();
    expect(after).toEqual({ ok: true, connected: true, active: true, missing: [] });
    const set = evoCalls.find((c) => c.startsWith("setInstanceWebhook"));
    expect(set).toContain(`"url":"https://imobflux.test/api/webhooks/whatsapp"`);
    expect(set).toContain(`"includeHistory":true`);
  });

  test("janela de histórico 0 reaplica sem o evento de histórico; instância inexistente = sem conexão; sem segredo recusa", async () => {
    evolution.getInstanceWebhookEvents = async () => ({ ok: false, code: "NOT_FOUND" });
    expect(await actions.getWhatsappWebhookStatusAction()).toEqual({ ok: true, connected: false, active: null, missing: [] });
    stubConnectionRows([{ history_window_days: 0 }]);
    evolution.getInstanceWebhookEvents = async () => ({ ok: true, data: null });
    await actions.updateWhatsappWebhookEventsAction();
    expect(evoCalls.find((c) => c.startsWith("setInstanceWebhook"))).toContain(`"includeHistory":false`);
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    expect(await actions.updateWhatsappWebhookEventsAction()).toMatchObject({ ok: false });
  });
});
