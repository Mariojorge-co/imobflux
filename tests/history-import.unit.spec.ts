try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: { __esModule: true } };
} catch {
  // Ignorar
}

import { expect, test } from "@playwright/test";
import { HISTORY_CHUNK_SIZE, parseEvolutionWebhookPayload, type WebhookHistoryResult } from "../lib/conversations/webhook";
import { importHistoryBatch } from "../lib/conversations/history-import";
import {
  HISTORY_FAILURE_MESSAGE,
  HISTORY_IMPORT_TIMEOUT_MS,
  resolveHistoryImport,
  shouldWarnAboutHistory,
} from "../lib/whatsapp/history-status";

const DAY = 24 * 60 * 60;
const nowSec = () => Math.floor(Date.now() / 1000);

function message(id: string, jid: string, ageDays: number, text: string | null, extra: Record<string, unknown> = {}) {
  return {
    key: { id, remoteJid: jid, fromMe: false, ...(jid.endsWith("@g.us") ? { participant: "5582988880001@s.whatsapp.net" } : {}) },
    pushName: "Cliente",
    message: text === null ? { reactionMessage: { text: "👍" } } : { conversation: text },
    messageTimestamp: nowSec() - Math.floor(ageDays * DAY),
    ...extra,
  };
}

function setPayload(messages: unknown[], extra: Record<string, unknown> = {}) {
  return { event: "messages.set", instance: "inst-1", data: messages, isLatest: false, progress: 40, ...extra };
}

test.describe("Histórico do WhatsApp: lote messages.set", () => {
  test("importa só os últimos 15 dias e descarta o resto", () => {
    const result = parseEvolutionWebhookPayload(setPayload([
      message("a", "5582988880001@s.whatsapp.net", 3, "recente"),
      message("b", "5582988880001@s.whatsapp.net", 14.5, "quase 15 dias"),
      message("c", "5582988880001@s.whatsapp.net", 16, "velha"),
      message("d", "5582988880001@s.whatsapp.net", 400, "muito velha"),
    ]));
    expect(result.status).toBe("history");
    if (result.status !== "history") return;
    expect(result.items.map((item) => item.external_message_id)).toEqual(["a", "b"]);
    expect(result.received).toBe(4);
    expect(result.skipped).toBe(2);
  });

  test("lê isLatest e progress do nível do corpo", () => {
    const partial = parseEvolutionWebhookPayload(setPayload([], { isLatest: false, progress: 35 }));
    const last = parseEvolutionWebhookPayload(setPayload([], { isLatest: true, progress: 100 }));
    expect(partial).toMatchObject({ status: "history", isLatest: false, progress: 35 });
    expect(last).toMatchObject({ status: "history", isLatest: true, progress: 100 });
  });

  test("ignora transmissão, canais, reações, sem texto e sem data; mídia vira rótulo", () => {
    const result = parseEvolutionWebhookPayload(setPayload([
      message("s1", "status@broadcast", 1, "status"),
      message("n1", "120363@newsletter", 1, "canal"),
      message("r1", "5582988880001@s.whatsapp.net", 1, null),
      { key: { id: "t1", remoteJid: "5582988880001@s.whatsapp.net", fromMe: false }, message: { conversation: "sem data" } },
      { key: { id: "m1", remoteJid: "5582988880001@s.whatsapp.net", fromMe: false }, messageTimestamp: nowSec() - DAY, message: { documentMessage: { fileName: "holerite.pdf", mimetype: "application/pdf" } } },
      "lixo",
      null,
    ]));
    expect(result.status).toBe("history");
    if (result.status !== "history") return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0].text_content).toBe("📄 Documento: holerite.pdf");
    expect(result.skipped).toBe(6);
  });

  test("grupo mantém o remetente; mensagem enviada por mim não leva nome", () => {
    const result = parseEvolutionWebhookPayload(setPayload([
      message("g1", "120363000000000001@g.us", 2, "oi grupo"),
      message("o1", "5582988880002@s.whatsapp.net", 2, "resposta", { key: { id: "o1", remoteJid: "5582988880002@s.whatsapp.net", fromMe: true }, pushName: "Você" }),
    ]));
    if (result.status !== "history") throw new Error("esperava history");
    expect(result.items[0]).toMatchObject({ remote_jid: "120363000000000001@g.us", sender_jid: "5582988880001@s.whatsapp.net", from_me: false });
    expect(result.items[1]).toMatchObject({ from_me: true, push_name: null });
  });

  test("grupo sem remetente em mensagem recebida é descartado", () => {
    const result = parseEvolutionWebhookPayload(setPayload([
      { key: { id: "g2", remoteJid: "120363000000000001@g.us", fromMe: false }, messageTimestamp: nowSec() - DAY, message: { conversation: "sem autor" } },
    ]));
    if (result.status !== "history") throw new Error("esperava history");
    expect(result.items).toHaveLength(0);
  });

  test("data que não é lista é rejeitada; mensagem ao vivo continua intacta", () => {
    expect(parseEvolutionWebhookPayload({ event: "messages.set", instance: "x", data: { a: 1 } }).status).toBe("malformed");
    const live = parseEvolutionWebhookPayload({
      event: "messages.upsert",
      instance: "x",
      data: { key: { id: "L1", remoteJid: "5582988880001@s.whatsapp.net", fromMe: false }, pushName: "Ana", message: { conversation: "oi" }, messageTimestamp: nowSec() },
    });
    expect(live.status).toBe("valid");
  });
});

function fakeClient(options: { failIngest?: boolean; itemFailures?: number } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "ingest_whatsapp_history_batch") {
        if (options.failIngest) return { data: null, error: { message: "boom" } };
        const size = (args.p_messages as unknown[]).length;
        return {
          data: { imported: size - (options.itemFailures ?? 0), duplicate: 0, ignored: 0, failed: options.itemFailures ?? 0, first_error: options.itemFailures ? "erro de item" : null },
          error: null,
        };
      }
      return { data: { status: "success" }, error: null };
    },
  };
  return { client: client as never, calls };
}

function batch(count: number, overrides: Partial<WebhookHistoryResult> = {}): WebhookHistoryResult {
  return {
    status: "history",
    instance: "inst-1",
    items: Array.from({ length: count }, (_, index) => ({
      external_message_id: `m${index}`,
      remote_jid: "5582988880001@s.whatsapp.net",
      sender_jid: null,
      from_me: false,
      push_name: "Cliente",
      text_content: `texto ${index}`,
      occurred_at: new Date().toISOString(),
    })),
    received: count,
    skipped: 0,
    isLatest: false,
    progress: 50,
    ...overrides,
  };
}

test.describe("Histórico do WhatsApp: importação em lotes", () => {
  test("lote grande é dividido em pedaços e o resultado é somado", async () => {
    const { client, calls } = fakeClient();
    const summary = await importHistoryBatch(client, batch(HISTORY_CHUNK_SIZE * 2 + 120));
    const ingests = calls.filter((call) => call.name === "ingest_whatsapp_history_batch");
    expect(ingests.map((call) => (call.args.p_messages as unknown[]).length)).toEqual([HISTORY_CHUNK_SIZE, HISTORY_CHUNK_SIZE, 120]);
    expect(summary.imported).toBe(HISTORY_CHUNK_SIZE * 2 + 120);
    const progress = calls.at(-1);
    expect(progress?.name).toBe("record_whatsapp_history_progress");
    expect(progress?.args).toMatchObject({ p_external_account_id: "inst-1", p_imported: HISTORY_CHUNK_SIZE * 2 + 120, p_progress: 50, p_is_latest: false });
    expect(progress?.args.p_error).toBeUndefined();
  });

  test("último lote informa isLatest para concluir a importação", async () => {
    const { client, calls } = fakeClient();
    await importHistoryBatch(client, batch(3, { isLatest: true, progress: 100 }));
    expect(calls.at(-1)?.args).toMatchObject({ p_is_latest: true, p_progress: 100 });
  });

  test("lote vazio ainda registra o andamento", async () => {
    const { client, calls } = fakeClient();
    await importHistoryBatch(client, batch(0, { isLatest: true, progress: 100 }));
    expect(calls.map((call) => call.name)).toEqual(["record_whatsapp_history_progress"]);
  });

  test("falha do banco registra o erro na conexão e sobe para o webhook responder 500", async () => {
    const { client, calls } = fakeClient({ failIngest: true });
    await expect(importHistoryBatch(client, batch(10))).rejects.toThrow(/Falha ao gravar um lote do histórico/);
    const recorded = calls.find((call) => call.name === "record_whatsapp_history_progress");
    expect(String(recorded?.args.p_error)).toContain("Falha ao gravar um lote do histórico");
  });

  test("itens que falharam viram erro registrado (aviso visível ao OWNER)", async () => {
    const { client, calls } = fakeClient({ itemFailures: 2 });
    const summary = await importHistoryBatch(client, batch(10));
    expect(summary.failed).toBe(2);
    expect(String(calls.at(-1)?.args.p_error)).toContain("2 mensagens do histórico não puderam ser gravadas");
  });
});

test.describe("Histórico do WhatsApp: o que o OWNER vê", () => {
  const started = "2026-10-12T10:00:00.000Z";
  const t0 = new Date(started).getTime();
  const row = (status: string | null, extra: Record<string, unknown> = {}) => ({
    status, startedAt: started, finishedAt: null, importedCount: 0, error: null, ...extra,
  });

  test("sem conexão pareada ou sem histórico: nada a mostrar", () => {
    expect(resolveHistoryImport(null)).toEqual({ state: "none" });
    expect(resolveHistoryImport(row(null))).toEqual({ state: "none" });
  });

  test("importando dentro do prazo, concluída e com erro", () => {
    expect(resolveHistoryImport(row("importing", { importedCount: 4 }), t0 + 60_000)).toEqual({ state: "importing", importedCount: 4 });
    expect(resolveHistoryImport(row("completed", { importedCount: 9 }), t0 + 99_999_999)).toEqual({ state: "completed", importedCount: 9 });
    expect(resolveHistoryImport(row("failed", { importedCount: 2, error: "x" }), t0)).toEqual({ state: "failed", importedCount: 2, reason: "error", detail: "x" });
  });

  test("importando além de 10 minutos vira falha por prazo (nunca fica em silêncio)", () => {
    const view = resolveHistoryImport(row("importing"), t0 + HISTORY_IMPORT_TIMEOUT_MS + 1);
    expect(view).toMatchObject({ state: "failed", reason: "timeout" });
    expect(resolveHistoryImport(row("importing"), t0 + HISTORY_IMPORT_TIMEOUT_MS - 1).state).toBe("importing");
  });

  test("o aviso nas Conversas aparece só para falha e some depois de 7 dias", () => {
    const failed = resolveHistoryImport(row("failed", { error: "x" }), t0);
    expect(shouldWarnAboutHistory(failed, started, t0 + 1000)).toBe(true);
    expect(shouldWarnAboutHistory(failed, started, t0 + 8 * 24 * 3600 * 1000)).toBe(false);
    expect(shouldWarnAboutHistory({ state: "completed", importedCount: 3 }, started, t0)).toBe(false);
    expect(shouldWarnAboutHistory({ state: "importing", importedCount: 0 }, started, t0)).toBe(false);
  });

  test("a mensagem de falha avisa que só mensagens novas serão capturadas", () => {
    expect(HISTORY_FAILURE_MESSAGE).toBe(
      "Importação de histórico não foi concluída, a partir de agora só mensagens novas serão capturadas.",
    );
  });
});
