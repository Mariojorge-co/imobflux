import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import type { ConversationMessage } from "../lib/conversations/data";
import {
  buildPendingMessage,
  collapseEchoDuplicates,
  ECHO_WINDOW_MS,
  isPendingMessage,
  mergeMessages,
  outgoingStatusLabel,
  removePendingMessage,
} from "../lib/conversations/message-merge";
import {
  conversationPatchFromMessage,
  countsForSla,
  describeConversationSla,
  isConversationClosed,
  pickSlaMessage,
  slaPatchFromMessage,
} from "../lib/conversations/sla-display";
import {
  isStickerAttachment,
  isStickerMessage,
  MEDIA_MAX_HEIGHT_DESKTOP_PX,
  MEDIA_MAX_HEIGHT_MOBILE_PX,
  STICKER_MAX_PX,
} from "../lib/conversations/sticker";

/* eslint-disable @typescript-eslint/no-require-imports */
const adminModule = require("@/lib/supabase/admin");
const dal = require("@/lib/auth/dal") as typeof import("@/lib/auth/dal");
const serverModule = require("@/lib/supabase/server");
const conversationData = require("@/lib/conversations/data") as typeof import("@/lib/conversations/data");
/* eslint-enable @typescript-eslint/no-require-imports */

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function message(over: Partial<ConversationMessage> & { id: string }): ConversationMessage {
  return {
    direction: "incoming",
    origin: "whatsapp",
    status: "received",
    text_content: "oi",
    occurred_at: minutesAgo(5),
    has_attachments: false,
    ...over,
  };
}

test.describe("contador de espera: uma regra para lista, cabeçalho e Prioridades", () => {
  test("aberta, última mensagem do cliente: 'cliente aguardando' (a equipe deve resposta)", () => {
    const sla = describeConversationSla({ sla_direction: "incoming", sla_at: minutesAgo(12) });
    expect(sla).toMatchObject({ teamWaiting: true, tone: "yellow" });
    expect(sla?.fullLabel).toContain("Cliente aguardando");
  });

  test("aberta, última mensagem nossa: 'aguardando cliente' continua, em cinza neutro", () => {
    const sla = describeConversationSla({ sla_direction: "outgoing", sla_at: minutesAgo(50) });
    expect(sla).toMatchObject({ teamWaiting: false, tone: "neutral" });
    expect(sla?.fullLabel).toContain("Aguardando cliente");
  });

  test("o contador continua passando nos dois sentidos (cliente: vermelho depois de 30 min; nossa: follow-up depois de 48 h)", () => {
    expect(describeConversationSla({ sla_direction: "incoming", sla_at: minutesAgo(45) })).toMatchObject({ tone: "red", urgent: true });
    expect(describeConversationSla({ sla_direction: "outgoing", sla_at: minutesAgo(60 * 49) })).toMatchObject({ tone: "orange" });
  });

  test("conversa fechada/resolvida (arquivada): nenhum chip, qualquer que seja a última mensagem", () => {
    for (const direction of ["incoming", "outgoing"]) {
      expect(describeConversationSla({ archived_at: minutesAgo(1), sla_direction: direction, sla_at: minutesAgo(90) })).toBeNull();
      expect(describeConversationSla({ operational_status: "archived", sla_direction: direction, sla_at: minutesAgo(90) })).toBeNull();
    }
    expect(isConversationClosed({ archived_at: minutesAgo(1) })).toBe(true);
    expect(isConversationClosed({ archived_at: null, operational_status: "active" })).toBe(false);
  });

  test("sem mensagens (ou sem mensagem válida): sem chip", () => {
    expect(describeConversationSla({})).toBeNull();
    expect(describeConversationSla({ sla_direction: null, sla_at: null })).toBeNull();
    expect(describeConversationSla(null)).toBeNull();
    expect(describeConversationSla(undefined)).toBeNull();
  });

  test("mensagem que falhou não conta como resposta; nota interna, sistema e provisória também não contam", () => {
    const incoming = { id: "a", direction: "incoming", status: "received", occurred_at: minutesAgo(40) };
    const failedReply = { id: "b", direction: "outgoing", status: "failed", occurred_at: minutesAgo(5) };
    expect(countsForSla(failedReply)).toBe(false);
    expect(pickSlaMessage([incoming, failedReply])).toBe(incoming);
    expect(countsForSla({ id: "n", direction: "internal_note", status: "saved", occurred_at: minutesAgo(1) })).toBe(false);
    expect(countsForSla({ id: "s", direction: "system", status: "ok", occurred_at: minutesAgo(1) })).toBe(false);
    expect(countsForSla({ id: "pending-x", direction: "outgoing", status: "sending", occurred_at: minutesAgo(0) })).toBe(false);
    expect(countsForSla({ id: "h", direction: "incoming", status: "received", occurred_at: minutesAgo(1), is_history: true })).toBe(false);
    expect(pickSlaMessage([failedReply])).toBeNull();
    expect(pickSlaMessage([])).toBeNull();
    // resposta enviada com sucesso conta e inverte o sentido
    const sentReply = { id: "c", direction: "outgoing", status: "sent", occurred_at: minutesAgo(2) };
    expect(pickSlaMessage([incoming, failedReply, sentReply])).toBe(sentReply);
  });

  test("mensagem nova atualiza o contador só quando conta", () => {
    expect(slaPatchFromMessage({ id: "x", direction: "outgoing", status: "sent", occurred_at: "2026-10-14T10:00:00Z" })).toEqual({ sla_direction: "outgoing", sla_at: "2026-10-14T10:00:00Z" });
    expect(slaPatchFromMessage({ id: "y", direction: "outgoing", status: "failed", occurred_at: "2026-10-14T10:00:00Z" })).toEqual({});
  });

  test("reabertura: mensagem do cliente numa conversa encerrada reabre e o contador volta; mensagem nossa não reabre", () => {
    const closed = { archived_at: minutesAgo(30), operational_status: "archived" };
    const clientMessage = { id: "m1", direction: "incoming", status: "received", occurred_at: minutesAgo(0) };
    const reopened = conversationPatchFromMessage(closed, clientMessage);
    expect(reopened).toMatchObject({ archived_at: null, operational_status: "active", sla_direction: "incoming" });
    const afterReopen = { ...closed, ...reopened };
    expect(isConversationClosed(afterReopen)).toBe(false);
    expect(describeConversationSla({ ...afterReopen, sla_at: reopened.sla_at })).not.toBeNull();

    const ours = conversationPatchFromMessage(closed, { id: "m2", direction: "outgoing", status: "sent", occurred_at: minutesAgo(0) });
    expect(ours.archived_at).toBeUndefined();
    expect(ours.operational_status).toBeUndefined();
    // histórico importado nunca reabre
    const history = conversationPatchFromMessage(closed, { id: "m3", direction: "incoming", status: "received", occurred_at: minutesAgo(0), is_history: true });
    expect(history.archived_at).toBeUndefined();
    // mensagem do cliente ANTERIOR ao encerramento (já estava lá quando a conversa foi encerrada) nunca reabre
    const old = conversationPatchFromMessage(closed, { id: "m4", direction: "incoming", status: "received", occurred_at: minutesAgo(45) });
    expect(old.archived_at).toBeUndefined();
    expect(old.operational_status).toBeUndefined();
    // conversa já aberta: nada a reabrir
    expect(conversationPatchFromMessage({ archived_at: null, operational_status: "active" }, clientMessage).archived_at).toBeUndefined();
  });
});

test.describe("mensagens: bolha provisória e eco do webhook", () => {
  test("a bolha provisória nasce 'enviando…' e não conta para o contador", () => {
    const pending = buildPendingMessage({ idempotencyKey: "k1", text: "Olá", now: new Date("2026-10-14T10:00:00Z") });
    expect(pending).toMatchObject({ id: "pending-k1", direction: "outgoing", origin: "crm", status: "sending", text_content: "Olá", occurred_at: "2026-10-14T10:00:00.000Z" });
    expect(isPendingMessage(pending)).toBe(true);
    expect(outgoingStatusLabel(pending)).toBe("sending");
    expect(outgoingStatusLabel(message({ id: "f", direction: "outgoing", status: "failed" }))).toBe("failed");
    expect(outgoingStatusLabel(message({ id: "q", direction: "outgoing", status: "queued" }))).toBe("sending");
    expect(outgoingStatusLabel(message({ id: "s", direction: "outgoing", status: "sent" }))).toBeNull();
    expect(outgoingStatusLabel(message({ id: "i", direction: "incoming", status: "received" }))).toBeNull();
  });

  test("envio concluído: a provisória sai e a mensagem gravada entra (uma bolha só)", () => {
    const pending = buildPendingMessage({ idempotencyKey: "k2", text: "Bom dia", now: new Date() });
    const saved = message({ id: "real-1", direction: "outgoing", origin: "crm", status: "sent", text_content: "Bom dia", occurred_at: new Date().toISOString() });
    const afterSettle = mergeMessages(removePendingMessage(mergeMessages([], [pending]), pending.id), [saved]);
    expect(afterSettle.map((m) => m.id)).toEqual(["real-1"]);
  });

  test("falha: a provisória some e a mensagem 'failed' do servidor aparece marcada como não enviada", () => {
    const pending = buildPendingMessage({ idempotencyKey: "k3", text: "Oi", now: new Date() });
    const failed = message({ id: "real-2", direction: "outgoing", origin: "crm", status: "failed", text_content: "Oi", occurred_at: new Date().toISOString() });
    const result = mergeMessages(removePendingMessage([pending], pending.id), [failed]);
    expect(result).toHaveLength(1);
    expect(outgoingStatusLabel(result[0])).toBe("failed");
  });

  test("durante o envio, a versão 'na fila' vinda do servidor não duplica a provisória", () => {
    const pending = buildPendingMessage({ idempotencyKey: "k4", text: "Segue o folder", now: new Date() });
    const queued = message({ id: "real-3", direction: "outgoing", origin: "crm", status: "queued", text_content: "Segue o folder", occurred_at: new Date().toISOString() });
    expect(mergeMessages([pending], [queued]).map((m) => m.id)).toEqual(["real-3"]);
  });

  test("duas mensagens iguais seguidas: cada provisória casa com uma versão do servidor, uma para uma", () => {
    const first = buildPendingMessage({ idempotencyKey: "a", text: "ok", now: new Date() });
    const second = buildPendingMessage({ idempotencyKey: "b", text: "ok", now: new Date(Date.now() + 1000) });
    const sentFirst = message({ id: "r1", direction: "outgoing", origin: "crm", status: "sent", text_content: "ok", occurred_at: new Date().toISOString() });
    // a primeira já foi enviada (status sent): não consome a provisória da segunda
    const result = mergeMessages([second], [sentFirst]);
    expect(result.map((m) => m.id).sort()).toEqual(["pending-b", "r1"]);
    expect(first.id).toBe("pending-a");
  });

  test("eco do webhook: mensagem nossa de origem WhatsApp com o mesmo texto no mesmo instante some da tela", () => {
    const own = message({ id: "crm-1", direction: "outgoing", origin: "crm", status: "sent", text_content: "Posso ligar?", occurred_at: minutesAgo(1) });
    const echo = message({ id: "wa-1", direction: "outgoing", origin: "whatsapp", status: "sent", text_content: "Posso  ligar?", occurred_at: new Date(Date.now() - 59_000).toISOString() });
    expect(collapseEchoDuplicates([own, echo]).map((m) => m.id)).toEqual(["crm-1"]);
    expect(mergeMessages([own], [echo]).map((m) => m.id)).toEqual(["crm-1"]);
  });

  test("o eco só é escondido quando é mesmo o eco: texto diferente, fora da janela, com anexo, histórico ou do cliente ficam", () => {
    const own = message({ id: "crm-1", direction: "outgoing", origin: "crm", status: "sent", text_content: "Posso ligar?", occurred_at: minutesAgo(10) });
    const otherText = message({ id: "wa-2", direction: "outgoing", origin: "whatsapp", text_content: "Outra coisa", occurred_at: minutesAgo(10) });
    const late = message({ id: "wa-3", direction: "outgoing", origin: "whatsapp", text_content: "Posso ligar?", occurred_at: new Date(Date.parse(own.occurred_at) + ECHO_WINDOW_MS + 5_000).toISOString() });
    const withFile = message({ id: "wa-4", direction: "outgoing", origin: "whatsapp", text_content: "Posso ligar?", occurred_at: own.occurred_at, has_attachments: true });
    const history = message({ id: "wa-5", direction: "outgoing", origin: "whatsapp", text_content: "Posso ligar?", occurred_at: own.occurred_at, is_history: true });
    const fromClient = message({ id: "wa-6", direction: "incoming", origin: "whatsapp", text_content: "Posso ligar?", occurred_at: own.occurred_at });
    const ids = collapseEchoDuplicates([own, otherText, late, withFile, history, fromClient]).map((m) => m.id);
    expect(ids).toEqual(["crm-1", "wa-2", "wa-3", "wa-4", "wa-5", "wa-6"]);
  });

  test("resposta que falhou não esconde o eco de uma mensagem igual enviada pelo celular", () => {
    const failedOwn = message({ id: "crm-f", direction: "outgoing", origin: "crm", status: "failed", text_content: "Oi", occurred_at: minutesAgo(1) });
    const echo = message({ id: "wa-e", direction: "outgoing", origin: "whatsapp", text_content: "Oi", occurred_at: minutesAgo(1) });
    expect(collapseEchoDuplicates([failedOwn, echo]).map((m) => m.id)).toEqual(["crm-f", "wa-e"]);
  });

  test("a lista fica ordenada por hora e a versão nova de um mesmo id substitui a antiga", () => {
    const a = message({ id: "a", occurred_at: "2026-10-14T10:00:00Z" });
    const b = message({ id: "b", occurred_at: "2026-10-14T10:05:00Z" });
    const aNew = message({ id: "a", occurred_at: "2026-10-14T10:00:00Z", text_content: "editada" });
    const result = mergeMessages([b, a], [aNew]);
    expect(result.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result[0].text_content).toBe("editada");
  });
});

test.describe("figurinha e limites de mídia", () => {
  test("detecta figurinha: webp com nome 'figurinha' ou rótulo 'Figurinha'", () => {
    expect(isStickerAttachment({ file_name: "figurinha", mime_type: "image/webp" })).toBe(true);
    expect(isStickerAttachment({ file_name: "Figurinha", mime_type: "IMAGE/WEBP; charset=x" })).toBe(true);
    expect(isStickerAttachment({ file_name: "abc.webp", mime_type: "image/webp" }, "Figurinha")).toBe(true);
    expect(isStickerMessage({ text_content: "Figurinha", attachments: [{ file_name: "figurinha", mime_type: "image/webp" }] })).toBe(true);
  });

  test("foto comum, webp com legenda de verdade, documento e mensagem sem anexo NÃO são figurinha", () => {
    expect(isStickerAttachment({ file_name: "imagem", mime_type: "image/jpeg" }, "Figurinha")).toBe(false);
    expect(isStickerAttachment({ file_name: "imagem", mime_type: "image/webp" }, "Olha essa foto do imóvel")).toBe(false);
    expect(isStickerAttachment({ file_name: "figurinha", mime_type: "application/pdf" })).toBe(false);
    expect(isStickerAttachment({ file_name: null, mime_type: null })).toBe(false);
    expect(isStickerMessage({ text_content: "Figurinha", attachments: [] })).toBe(false);
    expect(isStickerMessage({ text_content: "Figurinha" })).toBe(false);
    expect(isStickerMessage({ text_content: "Figurinha", attachments: [{ file_name: "figurinha", mime_type: "image/webp" }, { file_name: "x", mime_type: "image/png" }] })).toBe(false);
  });

  test("limites: figurinha até 140 px; foto e vídeo até 220 px no celular e 280 px no desktop", () => {
    expect(STICKER_MAX_PX).toBe(140);
    expect(MEDIA_MAX_HEIGHT_MOBILE_PX).toBe(220);
    expect(MEDIA_MAX_HEIGHT_DESKTOP_PX).toBe(280);
  });
});

test.describe("acesso em uma consulta (getActiveAccessForAuthUser) e abertura da conversa", () => {
  const originalAdmin = adminModule.createAdminSupabaseClient;
  const originalServer = serverModule.createServerSupabaseClient;
  let queries: Array<{ table: string; filters: Array<[string, unknown]> }>;
  let membership: unknown;

  test.beforeEach(() => {
    queries = [];
    membership = null;
    adminModule.createAdminSupabaseClient = () => ({
      from: (table: string) => {
        const record = { table, filters: [] as Array<[string, unknown]> };
        queries.push(record);
        const chain = {
          select: () => chain,
          eq: (column: string, value: unknown) => { record.filters.push([column, value]); return chain; },
          in: (column: string, value: unknown) => { record.filters.push([column, value]); return chain; },
          limit: () => chain,
          maybeSingle: async () => ({ data: membership, error: null }),
        };
        return chain;
      },
    });
  });
  test.afterEach(() => {
    adminModule.createAdminSupabaseClient = originalAdmin;
    serverModule.createServerSupabaseClient = originalServer;
  });

  const row = (over: Record<string, unknown> = {}) => ({
    id: "member-1",
    role: "owner",
    status: "active",
    workspace_id: "ws-1",
    app_users: { id: "user-1", display_name: "Dono", status: "active", auth_user_id: "auth-1" },
    workspaces: { id: "ws-1", status: "active" },
    ...over,
  });

  test("vínculo ativo, usuário ativo e workspace ativo: acesso completo, com UMA consulta", async () => {
    membership = row();
    expect(await dal.getActiveAccessForAuthUser("auth-1")).toEqual({
      appUserId: "user-1", authUserId: "auth-1", displayName: "Dono", memberId: "member-1", role: "owner", workspaceId: "ws-1",
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("workspace_members");
    expect(queries[0].filters).toContainEqual(["app_users.auth_user_id", "auth-1"]);
    expect(queries[0].filters).toContainEqual(["status", "active"]);
    expect(queries[0].filters).toContainEqual(["role", ["owner", "attendant"]]);
  });

  test("sem vínculo, usuário inativo ou workspace inativo/ausente: sem acesso", async () => {
    membership = null;
    expect(await dal.getActiveAccessForAuthUser("auth-1")).toBeNull();
    membership = row({ app_users: { id: "user-1", display_name: "X", status: "inactive", auth_user_id: "auth-1" } });
    expect(await dal.getActiveAccessForAuthUser("auth-1")).toBeNull();
    membership = row({ workspaces: { id: "ws-1", status: "suspended" } });
    expect(await dal.getActiveAccessForAuthUser("auth-1")).toBeNull();
    membership = row({ workspaces: null });
    expect(await dal.getActiveAccessForAuthUser("auth-1")).toBeNull();
    membership = row({ app_users: null });
    expect(await dal.getActiveAccessForAuthUser("auth-1")).toBeNull();
  });

  test("atendente mantém o papel", async () => {
    membership = row({ role: "attendant" });
    expect((await dal.getActiveAccessForAuthUser("auth-1"))?.role).toBe("attendant");
  });

  test("erro do banco: sem acesso (nunca libera por falha)", async () => {
    adminModule.createAdminSupabaseClient = () => ({
      from: () => {
        const chain = { select: () => chain, eq: () => chain, in: () => chain, limit: () => chain, maybeSingle: async () => ({ data: row(), error: { message: "falha" } }) };
        return chain;
      },
    });
    expect(await dal.getActiveAccessForAuthUser("auth-1")).toBeNull();
  });

  test("getConversationById: uma chamada à RPC get_conversation_item (não recarrega a lista) e nulo sem acesso", async () => {
    const calls: string[] = [];
    let payload: unknown = { conversation_id: "c1", workspace_id: "ws-1", conversation_type: "individual", visibility: "commercial", operational_status: "active", started_at: "2026-10-14T10:00:00Z", last_activity_at: "2026-10-14T10:00:00Z", last_msg_text: "oi", last_msg_direction: "incoming", last_msg_occurred_at: "2026-10-14T10:00:00Z", participant_name: "Maria", participant_phone: "+5582988887000", is_unread: true, sla_direction: "incoming", sla_at: "2026-10-14T10:00:00Z" };
    serverModule.createServerSupabaseClient = async () => ({
      rpc: async (fn: string) => { calls.push(fn); return { data: payload, error: null }; },
    });
    const item = await conversationData.getConversationById("c1");
    expect(calls).toEqual(["get_conversation_item"]);
    expect(item).toMatchObject({ conversation_id: "c1", workspace_id: "ws-1", is_unread: true, sla_direction: "incoming", next_cursor_ts: null });
    payload = null;
    expect(await conversationData.getConversationById("c2")).toBeNull();
    expect(calls).toEqual(["get_conversation_item", "get_conversation_item"]);
  });

  test("getConversationById: erro do banco vira erro claro (a tela mostra a falha, não 'sem acesso')", async () => {
    serverModule.createServerSupabaseClient = async () => ({ rpc: async () => ({ data: null, error: { message: "boom" } }) });
    await expect(conversationData.getConversationById("c1")).rejects.toThrow("Não foi possível carregar a conversa.");
  });
});
