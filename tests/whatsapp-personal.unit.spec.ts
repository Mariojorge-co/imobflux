import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import { parseEvolutionWebhookPayload, type WebhookHistoryResult } from "../lib/conversations/webhook";
import { importHistoryBatch } from "../lib/conversations/history-import";
import {
  canChangeHistoryWindow,
  DEFAULT_INGEST_SETTINGS,
  describeIgnored,
  parseIngestSettings,
  pickCurrentConnection,
} from "../lib/whatsapp/ingest-settings";

/* eslint-disable @typescript-eslint/no-require-imports */
const adminModule = require("@/lib/supabase/admin");
const routeModule = require("@/app/api/webhooks/whatsapp/route");
const mediaModule = require("@/lib/conversations/media-download");
const evo = require("@/lib/whatsapp/evolution-instance") as typeof import("@/lib/whatsapp/evolution-instance");
/* eslint-enable @typescript-eslint/no-require-imports */

const upsert = (remoteJid: string, extra: Record<string, unknown> = {}) => ({
  event: "messages.upsert",
  instance: "inst-1",
  data: { key: { remoteJid, fromMe: false, id: "m1" }, pushName: "Alguém", message: { conversation: "oi" }, messageTimestamp: Math.floor(Date.now() / 1000), ...extra },
});

test.describe("entrada ao vivo: transmissão, canais e Status nunca viram conversa", () => {
  for (const jid of ["status@broadcast", "5582988886001@broadcast", "1234567890@broadcast", "82988886003@broadcast", "120363000000000001@newsletter"]) {
    test(`ignora ${jid}`, () => {
      expect(parseEvolutionWebhookPayload(upsert(jid))).toEqual({ status: "ignored", reason: "broadcast_or_channel" });
    });
  }

  test("conversa individual e grupo continuam sendo lidos normalmente", () => {
    expect(parseEvolutionWebhookPayload(upsert("5582988880001@s.whatsapp.net"))).toMatchObject({ status: "valid", conversationType: "individual" });
    expect(parseEvolutionWebhookPayload(upsert("120363000000000001@g.us", { key: { remoteJid: "120363000000000001@g.us", participant: "5582988880001@s.whatsapp.net", fromMe: false, id: "g1" } })))
      .toMatchObject({ status: "valid", conversationType: "group" });
  });
});

test.describe("rota do webhook com as chaves de entrada", () => {
  const originalEnv = process.env;
  const originalAdmin = adminModule.createAdminSupabaseClient;
  const originalSchedule = mediaModule.scheduleMediaDownload;
  let rpcCalls: Array<{ fnName: string; args: Record<string, unknown> }> = [];
  let scheduled = 0;
  let rpcResult: { data: unknown; error: unknown } = { data: { status: "success" }, error: null };

  const post = (body: unknown) =>
    routeModule.POST(new Request("http://localhost:3000/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "x-evolution-secret": "secret_token_123" },
      body: JSON.stringify(body),
    })) as Promise<Response>;

  test.beforeEach(() => {
    process.env = { ...originalEnv, EVOLUTION_WEBHOOK_SECRET: "secret_token_123", SUPABASE_ADMIN_KEY: "admin_key_secret" };
    rpcCalls = [];
    scheduled = 0;
    rpcResult = { data: { status: "success" }, error: null };
    adminModule.createAdminSupabaseClient = () => ({
      rpc: async (fnName: string, args: Record<string, unknown>) => { rpcCalls.push({ fnName, args }); return rpcResult; },
    });
    mediaModule.scheduleMediaDownload = () => { scheduled += 1; };
  });
  test.afterEach(() => {
    process.env = originalEnv;
    adminModule.createAdminSupabaseClient = originalAdmin;
    mediaModule.scheduleMediaDownload = originalSchedule;
  });

  test("lista de transmissão: 200, nenhuma chamada ao banco", async () => {
    const res = await post(upsert("5582988886001@broadcast"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored", reason: "broadcast_or_channel" });
    expect(rpcCalls).toHaveLength(0);
  });

  test("grupo com a chave desligada: o banco devolve 'ignored' e o webhook responde 200 sem baixar mídia", async () => {
    rpcResult = { data: { status: "ignored", reason: "groups_disabled" }, error: null };
    const res = await post({
      event: "messages.upsert",
      instance: "inst-1",
      data: {
        key: { remoteJid: "120363000000000001@g.us", participant: "5582988880001@s.whatsapp.net", fromMe: false, id: "g-media" },
        message: { imageMessage: { mimetype: "image/jpeg", caption: "foto do grupo" } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored", reason: "groups_disabled" });
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_group_text_message"]);
    expect(scheduled).toBe(0);
  });

  test("número desconhecido com o modo ligado: 200, sem anexo e sem download", async () => {
    rpcResult = { data: { status: "ignored", reason: "unknown_contact" }, error: null };
    const res = await post({
      event: "messages.upsert",
      instance: "inst-1",
      data: {
        key: { remoteJid: "5582988881001@s.whatsapp.net", fromMe: true, id: "u-media" },
        message: { documentMessage: { mimetype: "application/pdf", fileName: "x.pdf" } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored", reason: "unknown_contact" });
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_text_message"]);
    expect(scheduled).toBe(0);
  });

  test("histórico com janela 0: o banco descarta o lote e o webhook responde 200 sem registrar andamento", async () => {
    rpcResult = { data: { status: "success", imported: 0, duplicate: 0, ignored: 1, failed: 0, first_error: null, reason: "history_disabled" }, error: null };
    const res = await post({
      event: "messages.set",
      instance: "inst-1",
      isLatest: true,
      progress: 100,
      data: [{ key: { id: "h1", remoteJid: "5582988880001@s.whatsapp.net", fromMe: false }, message: { conversation: "antiga" }, messageTimestamp: Math.floor(Date.now() / 1000) - 3600 }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored", reason: "history_disabled", received: 1 });
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_history_batch"]);
  });
});

test.describe("importador de histórico com janela 0", () => {
  function batch(count: number): WebhookHistoryResult {
    return {
      status: "history",
      instance: "inst-1",
      items: Array.from({ length: count }, (_, index) => ({
        external_message_id: `m${index}`, remote_jid: "5582988880001@s.whatsapp.net", sender_jid: null, from_me: false,
        push_name: "C", text_content: `t${index}`, occurred_at: new Date().toISOString(),
      })),
      received: count, skipped: 0, isLatest: true, progress: 100,
    };
  }

  test("para no primeiro lote descartado e não registra andamento (sem aviso falso na tela)", async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string) => {
        calls.push(name);
        return { data: { status: "success", imported: 0, duplicate: 0, ignored: 500, failed: 0, first_error: null, reason: "history_disabled" }, error: null };
      },
    };
    const summary = await importHistoryBatch(client as never, batch(1200));
    expect(summary).toMatchObject({ disabled: true, imported: 0, ignored: 1200 });
    expect(calls).toEqual(["ingest_whatsapp_history_batch"]);
  });
});

test.describe("assinatura do webhook na Evolution", () => {
  const env = { EVOLUTION_API_URL: "http://evolution.test:8080", EVOLUTION_API_KEY: "k" };
  async function eventsFor(includeHistory?: boolean) {
    let body: { webhook?: { events?: string[] } } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response("{}", { status: 201, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await evo.setInstanceWebhook("inst", { url: "https://app.test/w", secret: "s", ...(includeHistory === undefined ? {} : { includeHistory }) }, { env, fetchImpl });
    return body.webhook?.events;
  }

  test("por padrão assina o histórico (MESSAGES_SET)", async () => {
    expect(await eventsFor()).toEqual(["MESSAGES_UPSERT", "MESSAGES_EDITED", "MESSAGES_DELETE", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "MESSAGES_SET"]);
    expect(await eventsFor(true)).toContain("MESSAGES_SET");
  });

  test("janela 0: NÃO assina MESSAGES_SET", async () => {
    // Sem histórico, mas SEMPRE com edição e exclusão (o celular precisa conseguir avisar o app delas).
    expect(await eventsFor(false)).toEqual(["MESSAGES_UPSERT", "MESSAGES_EDITED", "MESSAGES_DELETE", "MESSAGES_UPDATE", "CONNECTION_UPDATE"]);
  });
});

test.describe("chaves de entrada: leitura e texto", () => {
  test("sem linha, vale o padrão (grupos desligados, modo desligado, 15 dias)", () => {
    expect(parseIngestSettings(null)).toEqual(DEFAULT_INGEST_SETTINGS);
    expect(DEFAULT_INGEST_SETTINGS).toMatchObject({ ingestGroups: false, onlyKnownContacts: false, historyWindowDays: 15 });
  });

  test("lê as colunas e os contadores (ignora lixo)", () => {
    expect(parseIngestSettings({
      history_window_days: 0, ingest_groups: true, ingest_only_known_contacts: true,
      ignored_counts: { group: 3, unknown_contact: 7, invalid_phone: "x", extra: 9 },
    })).toEqual({ ingestGroups: true, onlyKnownContacts: true, historyWindowDays: 0, ignored: { groups: 3, unknownContacts: 7, invalidPhones: 0 } });
    expect(parseIngestSettings({ history_window_days: 99, ignored_counts: "oops" }).historyWindowDays).toBe(15);
  });

  test("a conexão atual é a ativa; senão a mais recente não substituída", () => {
    const rows = [
      { status: "replaced", created_at: "2026-10-03" },
      { status: "disconnected", created_at: "2026-10-02" },
      { status: "active", created_at: "2026-10-01" },
    ];
    expect(pickCurrentConnection(rows)?.status).toBe("active");
    expect(pickCurrentConnection(rows.slice(0, 2))?.status).toBe("disconnected");
    expect(pickCurrentConnection([{ status: "replaced" }])).toBeNull();
    expect(pickCurrentConnection([])).toBeNull();
  });

  test("a janela de histórico só muda antes do pareamento", () => {
    expect(canChangeHistoryWindow(null)).toBe(true);
    expect(canChangeHistoryWindow("configured")).toBe(true);
    expect(canChangeHistoryWindow("active")).toBe(false);
    expect(canChangeHistoryWindow("disconnected")).toBe(false);
  });

  test("resumo das mensagens ignoradas", () => {
    expect(describeIgnored({ groups: 0, unknownContacts: 0, invalidPhones: 0 })).toEqual([]);
    expect(describeIgnored({ groups: 2, unknownContacts: 5, invalidPhones: 1 })).toEqual(["5 de números não cadastrados", "2 de grupos", "1 de números inválidos"]);
  });
});
