import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import {
  EDIT_WINDOW_MS,
  FORWARD_MAX_TARGETS,
  REVOKE_WINDOW_MS,
  captionKeyAction,
  copyableText,
  editTimeLeftMs,
  groupReactions,
  messageCapabilities,
  replyPreviewText,
  snapshotFromMessage,
  splitForHighlight,
  type Viewer,
} from "@/lib/conversations/message-ui";
import { MAX_VOICE_SECONDS, formatVoiceTime, pickVoiceFormat, voiceErrorMessage } from "@/lib/conversations/voice";
import { describeActionFailure, messageActionErrorText } from "@/lib/conversations/message-action-errors";
import { classifyGatewayOutcome } from "@/lib/conversations/gateway-outcome";
import { buildPendingMessage, mergeMessages } from "@/lib/conversations/message-merge";
import { enqueueTextSend } from "@/lib/conversations/send-queue";
import { extractQuoted, parseEvolutionWebhookPayload } from "@/lib/conversations/webhook";
import type { ConversationMessage } from "@/lib/conversations/data";
import { categoryOf, describeAuditEvent, type AuditEventRow } from "@/lib/audit/labels";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gatewayModule = require("@/lib/supabase/gateway");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsGateway = require("@/lib/supabase/gateway-actions");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminModule = require("@/lib/supabase/admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routeModule = require("@/app/api/webhooks/whatsapp/route");

const OWNER: Viewer = { memberId: "member-owner", role: "owner" };
const ATTENDANT: Viewer = { memberId: "member-att", role: "attendant" };
const NOW = Date.parse("2026-10-15T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: "m1",
  direction: "outgoing",
  origin: "crm",
  status: "sent",
  text_content: "Olá",
  occurred_at: minutesAgo(1),
  has_attachments: false,
  internal_author_member_id: ATTENDANT.memberId,
  has_external_id: true,
  ...overrides,
});

test.describe("Pacote de mensagens — regras de tela", () => {
  test("editar: só texto nosso, enviado, com id do WhatsApp, até 15 min, autor ou dono", () => {
    expect(messageCapabilities(message(), ATTENDANT, { now: NOW }).canEdit).toBe(true);
    expect(messageCapabilities(message(), OWNER, { now: NOW }).canEdit).toBe(true);
    expect(messageCapabilities(message(), { memberId: "outro", role: "attendant" }, { now: NOW }).canEdit).toBe(false);
    expect(messageCapabilities(message({ occurred_at: minutesAgo(16) }), ATTENDANT, { now: NOW }).canEdit).toBe(false);
    expect(messageCapabilities(message({ occurred_at: minutesAgo(14) }), ATTENDANT, { now: NOW }).canEdit).toBe(true);
    expect(messageCapabilities(message({ has_attachments: true }), ATTENDANT, { now: NOW }).canEdit).toBe(false);
    expect(messageCapabilities(message({ has_external_id: false }), ATTENDANT, { now: NOW }).canEdit).toBe(false);
    expect(messageCapabilities(message({ direction: "incoming", origin: "whatsapp" }), OWNER, { now: NOW }).canEdit).toBe(false);
    expect(messageCapabilities(message({ origin: "whatsapp" }), OWNER, { now: NOW }).canEdit).toBe(false);
    expect(messageCapabilities(message({ is_history: true }), OWNER, { now: NOW }).canEdit).toBe(false);
    expect(EDIT_WINDOW_MS).toBe(15 * 60_000);
  });

  test("apagar para todos: 48 h; apagar para mim: qualquer mensagem visível", () => {
    expect(messageCapabilities(message({ occurred_at: minutesAgo(47 * 60) }), ATTENDANT, { now: NOW }).canDeleteForEveryone).toBe(true);
    expect(messageCapabilities(message({ occurred_at: minutesAgo(49 * 60) }), ATTENDANT, { now: NOW }).canDeleteForEveryone).toBe(false);
    expect(messageCapabilities(message({ has_attachments: true }), ATTENDANT, { now: NOW }).canDeleteForEveryone).toBe(true);
    expect(REVOKE_WINDOW_MS).toBe(48 * 3600_000);
    const incoming = messageCapabilities(message({ direction: "incoming", origin: "whatsapp" }), ATTENDANT, { now: NOW });
    expect(incoming.canDeleteForEveryone).toBe(false);
    expect(incoming.canHide).toBe(true);
    expect(incoming.canReply).toBe(true);
  });

  test("mensagem provisória, na fila, que falhou ou apagada: sem ações (só copiar, quando há texto)", () => {
    for (const status of ["sending", "queued", "failed"]) {
      const caps = messageCapabilities(message({ status }), OWNER, { now: NOW });
      expect(caps).toMatchObject({ canReply: false, canEdit: false, canDeleteForEveryone: false, canHide: false, canForward: false, canReact: false, canCopy: true });
    }
    expect(messageCapabilities(buildPendingMessage({ idempotencyKey: "k", text: "x" }), OWNER).canReply).toBe(false);
    // Apagada: ninguém age sobre ela; só o dono pode ver o original (auditoria).
    expect(Object.entries(messageCapabilities(message({ deleted_at: minutesAgo(1) }), ATTENDANT, { now: NOW })).filter(([, on]) => on)).toEqual([]);
    expect(Object.entries(messageCapabilities(message({ deleted_at: minutesAgo(1) }), OWNER, { now: NOW })).filter(([, on]) => on)).toEqual([["canViewHistory", true]]);
    expect(messageCapabilities(message({ edited_at: minutesAgo(1) }), OWNER, { now: NOW }).canViewHistory).toBe(true);
    expect(messageCapabilities(message({ edited_at: minutesAgo(1) }), ATTENDANT, { now: NOW }).canViewHistory).toBe(false);
  });

  test("reações só em conversa individual e em mensagem com id do WhatsApp; encaminhar precisa de conteúdo", () => {
    expect(messageCapabilities(message(), ATTENDANT, { isGroup: true, now: NOW }).canReact).toBe(false);
    expect(messageCapabilities(message({ has_external_id: false }), ATTENDANT, { now: NOW }).canReact).toBe(false);
    expect(messageCapabilities(message(), ATTENDANT, { now: NOW }).canReact).toBe(true);
    expect(messageCapabilities(message({ text_content: null }), ATTENDANT, { now: NOW }).canForward).toBe(false);
    expect(messageCapabilities(message({ text_content: null, has_attachments: true }), ATTENDANT, { now: NOW }).canForward).toBe(true);
    expect(messageCapabilities(message(), null, { now: NOW }).canReply).toBe(false);
    expect(FORWARD_MAX_TARGETS).toBe(5);
  });

  test("tempo restante para editar nunca fica negativo", () => {
    expect(editTimeLeftMs({ occurred_at: minutesAgo(5) }, NOW)).toBe(10 * 60_000);
    expect(editTimeLeftMs({ occurred_at: minutesAgo(30) }, NOW)).toBe(0);
  });

  test("reações iguais se juntam e marcam a minha", () => {
    const groups = groupReactions([
      { emoji: "👍", by: "member", mine: true, name: "Ana" },
      { emoji: "❤️", by: "contact", mine: false, name: "Cliente" },
      { emoji: "👍", by: "contact", mine: false, name: "Cliente" },
    ]);
    expect(groups).toEqual([
      { emoji: "👍", count: 2, mine: true, names: ["Ana", "Cliente"] },
      { emoji: "❤️", count: 1, mine: false, names: ["Cliente"] },
    ]);
    expect(groupReactions(undefined)).toEqual([]);
  });

  test("citação: texto, apagada, arquivo e resumo da mensagem respondida", () => {
    expect(replyPreviewText({ text: "oi" })).toBe("oi");
    expect(replyPreviewText({ text: "x".repeat(200) })).toHaveLength(141);
    expect(replyPreviewText({ deleted: true, text: "segredo" })).toBe("🚫 Mensagem apagada");
    expect(replyPreviewText({ has_media: true })).toBe("📎 Arquivo");
    expect(replyPreviewText(null)).toBe("Mensagem");
    expect(snapshotFromMessage(message({ internal_author_name: "Ana" }))).toMatchObject({ author: "Ana", direction: "outgoing", text: "Olá", deleted: false });
    expect(snapshotFromMessage(message({ direction: "incoming" }), "Cliente X")).toMatchObject({ author: "Cliente X" });
    expect(snapshotFromMessage(message({ deleted_at: minutesAgo(1) })).text).toBeNull();
    expect(copyableText(message({ deleted_at: minutesAgo(1) }))).toBe("");
    expect(copyableText(message())).toBe("Olá");
  });

  test("Enter envia, Shift+Enter quebra a linha, e a composição de acentos (IME) não envia", () => {
    expect(captionKeyAction({ key: "Enter", shiftKey: false })).toBe("send");
    expect(captionKeyAction({ key: "Enter", shiftKey: true })).toBe("newline");
    expect(captionKeyAction({ key: "Enter", shiftKey: false, isComposing: true })).toBe("none");
    expect(captionKeyAction({ key: "a", shiftKey: false })).toBe("none");
  });

  test("destaque da busca: sem diferenciar maiúsculas, termos curtos não destacam", () => {
    expect(splitForHighlight("Ponta Verde e ponta", "ponta")).toEqual([
      { text: "Ponta", match: true },
      { text: " Verde e ", match: false },
      { text: "ponta", match: true },
    ]);
    expect(splitForHighlight("abc", "a")).toEqual([{ text: "abc", match: false }]);
    expect(splitForHighlight("", "abc")).toEqual([{ text: "", match: false }]);
    expect(splitForHighlight("sem achar", "xyz")).toEqual([{ text: "sem achar", match: false }]);
  });
});

test.describe("Pacote de mensagens — áudio e frases de erro", () => {
  test("formato gravado: o melhor que o navegador sabe; nenhum deixa o navegador escolher", () => {
    expect(pickVoiceFormat(() => true)).toEqual({ mime: "audio/webm;codecs=opus", extension: "webm" });
    expect(pickVoiceFormat((mime) => mime === "audio/mp4")).toEqual({ mime: "audio/mp4", extension: "m4a" });
    expect(pickVoiceFormat(() => false)).toBeNull();
    expect(MAX_VOICE_SECONDS).toBe(600);
    expect(formatVoiceTime(0)).toBe("0:00");
    expect(formatVoiceTime(65)).toBe("1:05");
    expect(formatVoiceTime(600)).toBe("10:00");
  });

  test("microfone: permissão negada, sem aparelho, em uso e desconhecido têm frases amigáveis", () => {
    expect(voiceErrorMessage(new DOMException("x", "NotAllowedError"))).toContain("permissão foi negada");
    expect(voiceErrorMessage({ name: "NotFoundError" })).toContain("Nenhum microfone");
    expect(voiceErrorMessage({ name: "NotReadableError" })).toContain("em uso");
    expect(voiceErrorMessage(new Error("qualquer"))).toContain("Não foi possível acessar o microfone");
  });

  test("erros do banco viram frases em português (sem vazar o código técnico)", () => {
    expect(messageActionErrorText({ message: "message_edit_window_expired" })).toContain("15 minutos");
    expect(messageActionErrorText({ message: "message_revoke_window_expired" })).toContain("48 horas");
    expect(messageActionErrorText({ message: "pin_limit_reached" })).toContain("5 conversas");
    expect(messageActionErrorText({ message: "reaction_not_supported_group" })).toContain("grupos");
    expect(messageActionErrorText({ message: "algo", code: "42501" })).toContain("permissão");
    expect(messageActionErrorText({ message: "algo estranho" })).not.toContain("algo estranho");
  });

  test("falha da Evolution: diz o que NÃO mudou, e no tempo esgotado manda conferir no celular", () => {
    const rejected = classifyGatewayOutcome({ success: false, code: "HTTP_400" }, { NODE_ENV: "production" });
    const timeout = classifyGatewayOutcome({ success: false, code: "TIMEOUT" }, { NODE_ENV: "production" });
    const offline = classifyGatewayOutcome({ success: false, code: "MISSING_INSTANCE" }, { NODE_ENV: "production" });
    if (rejected.deliver || timeout.deliver || offline.deliver) throw new Error("esperava falha");
    expect(describeActionFailure(rejected, "A mensagem não foi alterada.")).toContain("A mensagem não foi alterada.");
    expect(describeActionFailure(offline, "A mensagem não foi alterada.")).toContain("não está conectado");
    expect(describeActionFailure(timeout, "A mensagem não foi alterada.")).toContain("confira no celular");
    expect(describeActionFailure(rejected, "x")).not.toContain("HTTP");
  });
});

test.describe("Pacote de mensagens — fila, citação e mesclagem", () => {
  test("a bolha provisória já nasce com a citação e a fila passa o id da mensagem respondida ao servidor", async () => {
    const calls: Array<unknown[]> = [];
    const handlers = { onSending: () => undefined, onSettled: () => undefined, onFailed: () => undefined };
    const { pending, done } = enqueueTextSend({
      conversationId: "c1",
      text: "resposta",
      handlers,
      replyTo: { messageId: "orig-1", snapshot: { author: "Cliente", text: "pergunta" } },
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      send: async (...args: unknown[]) => {
        calls.push(args);
        return { success: true as const };
      },
    });
    await done;
    expect(pending.reply_to_message_id).toBe("orig-1");
    expect(pending.reply_snapshot).toMatchObject({ text: "pergunta" });
    expect(calls[0]).toEqual(["c1", "resposta", "00000000-0000-4000-8000-000000000001", "orig-1"]);

    // Sem resposta: a chamada continua com 3 argumentos (nada muda para o envio comum).
    const plain: Array<unknown[]> = [];
    await enqueueTextSend({
      conversationId: "c1",
      text: "oi",
      handlers,
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      send: async (...args: unknown[]) => {
        plain.push(args);
        return { success: true as const };
      },
    }).done;
    expect(plain[0]).toHaveLength(3);
  });

  test("editar, apagar e reagir substituem a versão antiga pelo id", () => {
    const original = message({ id: "a", text_content: "antes", reactions: [] });
    const merged = mergeMessages([original], [{ ...original, text_content: "depois", edited_at: minutesAgo(0), reactions: [{ emoji: "👍", by: "contact", mine: false, name: "C" }] }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ text_content: "depois", reactions: [{ emoji: "👍" }] });
    const deleted = mergeMessages(merged, [{ ...merged[0], text_content: null, deleted_at: minutesAgo(0) }]);
    expect(deleted[0].deleted_at).not.toBeNull();
    expect(deleted[0].text_content).toBeNull();
  });
});

test.describe("Pacote de mensagens — webhook (entrada)", () => {
  const base = (data: Record<string, unknown>, event = "messages.upsert") => ({
    event,
    instance: "inst-1",
    data: { key: { remoteJid: "5582988880000@s.whatsapp.net", fromMe: false, id: "EV-1" }, ...data },
  });

  test("edição pelo protocolMessage (direto e dentro do envelope editedMessage): vira 'edit' com o texto novo", () => {
    const direct = parseEvolutionWebhookPayload(
      base({ message: { protocolMessage: { type: "MESSAGE_EDIT", key: { id: "ORIG" }, editedMessage: { conversation: "novo" }, timestampMs: 1760000000000 } } }),
    );
    expect(direct).toMatchObject({ status: "edit", externalMessageId: "ORIG", newText: "novo", editedAt: new Date(1760000000000).toISOString() });
    const wrapped = parseEvolutionWebhookPayload(
      base({ message: { editedMessage: { message: { protocolMessage: { type: 14, key: { id: "ORIG" }, editedMessage: { extendedTextMessage: { text: "novo 2" } } } } } } }, "messages.edited"),
    );
    expect(wrapped).toMatchObject({ status: "edit", externalMessageId: "ORIG", newText: "novo 2" });
    // Edição sem texto, ou sem a chave da original, não vira nada.
    expect(parseEvolutionWebhookPayload(base({ message: { protocolMessage: { type: 14, key: { id: "ORIG" } } } })).status).toBe("ignored");
    expect(parseEvolutionWebhookPayload(base({ message: { protocolMessage: { type: 14, editedMessage: { conversation: "x" } } } })).status).toBe("ignored");
  });

  test("exclusão pelo protocolMessage REVOKE e pelo evento messages.delete", () => {
    expect(parseEvolutionWebhookPayload(base({ message: { protocolMessage: { type: 0, key: { id: "ORIG" } } } }))).toMatchObject({ status: "revoke", externalMessageId: "ORIG" });
    expect(parseEvolutionWebhookPayload(base({ message: { protocolMessage: { type: "REVOKE", key: { id: "ORIG" } } } }))).toMatchObject({ status: "revoke" });
    expect(parseEvolutionWebhookPayload({ event: "messages.delete", instance: "inst-1", data: { key: { id: "ORIG", remoteJid: "x@s.whatsapp.net" } } })).toMatchObject({ status: "revoke", externalMessageId: "ORIG" });
    expect(parseEvolutionWebhookPayload({ event: "messages.delete", instance: "inst-1", data: { id: "ORIG" } })).toMatchObject({ status: "revoke", externalMessageId: "ORIG" });
    expect(parseEvolutionWebhookPayload({ event: "messages.delete", instance: "inst-1", data: {} }).status).toBe("ignored");
    // Outros tipos de protocolo (ex.: sincronização) são ignorados.
    expect(parseEvolutionWebhookPayload(base({ message: { protocolMessage: { type: 5, key: { id: "ORIG" } } } })).status).toBe("ignored");
  });

  test("reação: do cliente, do celular da conta (fromMe) e remoção; em grupo é ignorada", () => {
    const reaction = (fromMe: boolean, text: string, jid = "5582988880000@s.whatsapp.net") => ({
      event: "messages.upsert",
      instance: "inst-1",
      data: { key: { remoteJid: jid, fromMe, id: "EV-R" }, message: { reactionMessage: { key: { id: "ORIG", remoteJid: jid }, text } } },
    });
    expect(parseEvolutionWebhookPayload(reaction(false, "👍"))).toMatchObject({
      status: "reaction", targetExternalId: "ORIG", reactorJid: "5582988880000@s.whatsapp.net", fromMe: false, emoji: "👍",
    });
    expect(parseEvolutionWebhookPayload(reaction(true, "❤️"))).toMatchObject({ status: "reaction", fromMe: true, reactorJid: "", emoji: "❤️" });
    expect(parseEvolutionWebhookPayload(reaction(false, ""))).toMatchObject({ status: "reaction", emoji: "" });
    expect(parseEvolutionWebhookPayload(reaction(false, "👍", "120363000000000001@g.us")).status).toBe("ignored");
  });

  test("resposta recebida traz a citação (texto, legenda e arquivo); mensagem comum não", () => {
    const withQuote = parseEvolutionWebhookPayload(
      base({ message: { extendedTextMessage: { text: "resposta", contextInfo: { stanzaId: "ORIG", quotedMessage: { conversation: "pergunta original" } } } } }),
    );
    expect(withQuote).toMatchObject({ status: "valid", textContent: "resposta", quoted: { externalId: "ORIG", text: "pergunta original", hasMedia: false } });
    expect(extractQuoted({ imageMessage: { contextInfo: { stanzaId: "IMG", quotedMessage: { imageMessage: { caption: "foto da casa" } } } } })).toEqual({ externalId: "IMG", text: "foto da casa", hasMedia: true });
    expect(extractQuoted({ conversation: "oi" })).toBeNull();
    expect(extractQuoted(undefined)).toBeNull();
    const plain = parseEvolutionWebhookPayload(base({ message: { conversation: "oi" } }));
    expect(plain).toMatchObject({ status: "valid", quoted: null });
  });
});

test.describe("Pacote de mensagens — rota do webhook", () => {
  const original = adminModule.createAdminSupabaseClient;
  let calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let failWith: { code: string } | null = null;

  test.beforeEach(() => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "secret_token_123";
    calls = [];
    failWith = null;
    adminModule.createAdminSupabaseClient = () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (failWith) return { data: null, error: failWith };
        return { data: { status: "success", message_id: "msg-1" }, error: null };
      },
    });
  });
  test.afterEach(() => {
    adminModule.createAdminSupabaseClient = original;
  });

  const post = (body: unknown) =>
    routeModule.POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", headers: { "x-evolution-secret": "secret_token_123" }, body: JSON.stringify(body) }));

  test("edição, exclusão e reação chamam a função certa do banco, com a conta da instância", async () => {
    const jid = "5582988880000@s.whatsapp.net";
    expect((await post({ event: "messages.upsert", instance: "inst-1", data: { key: { remoteJid: jid, id: "E" }, message: { protocolMessage: { type: 14, key: { id: "ORIG" }, editedMessage: { conversation: "novo" } } } } })).status).toBe(200);
    expect((await post({ event: "messages.upsert", instance: "inst-1", data: { key: { remoteJid: jid, id: "D" }, message: { protocolMessage: { type: 0, key: { id: "ORIG" } } } } })).status).toBe(200);
    expect((await post({ event: "messages.upsert", instance: "inst-1", data: { key: { remoteJid: jid, id: "R", fromMe: false }, message: { reactionMessage: { key: { id: "ORIG" }, text: "🙏" } } } })).status).toBe(200);
    expect(calls.map((call) => call.fn)).toEqual(["ingest_whatsapp_message_edit", "ingest_whatsapp_message_delete", "ingest_whatsapp_reaction"]);
    expect(calls[0].args).toMatchObject({ p_external_account_id: "inst-1", p_external_message_id: "ORIG", p_new_text: "novo" });
    expect(calls[2].args).toMatchObject({ p_target_external_id: "ORIG", p_emoji: "🙏", p_from_me: false, p_reactor_jid: jid });
  });

  test("erro do banco devolve 500 (a Evolution tenta de novo) sem expor detalhes", async () => {
    failWith = { code: "XX000" };
    const response = await post({ event: "messages.upsert", instance: "inst-1", data: { key: { remoteJid: "5582988880000@s.whatsapp.net", id: "D" }, message: { protocolMessage: { type: 0, key: { id: "ORIG" } } } } });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("XX000");
  });

  test("resposta com citação liga a mensagem nova à original; falha ali não derruba o recebimento", async () => {
    const body = {
      event: "messages.upsert",
      instance: "inst-1",
      data: {
        key: { remoteJid: "5582988880000@s.whatsapp.net", fromMe: false, id: "NEW" },
        message: { extendedTextMessage: { text: "resposta", contextInfo: { stanzaId: "ORIG", quotedMessage: { conversation: "pergunta" } } } },
      },
    };
    expect((await post(body)).status).toBe(200);
    expect(calls.map((call) => call.fn)).toEqual(["ingest_whatsapp_text_message", "set_incoming_message_reply"]);
    expect(calls[1].args).toMatchObject({ p_message_id: "msg-1", p_quoted_external_id: "ORIG", p_snapshot: { text: "pergunta", has_media: false } });
  });
});

test.describe("Pacote de mensagens — chamadas à Evolution", () => {
  const realFetch = globalThis.fetch;
  type Call = { url: string; method: string; body: Record<string, unknown>; apikey: string | null };
  let calls: Call[] = [];
  let lookups: Array<{ url: string; numbers: unknown }> = [];
  let lookupJid: ((digits: string) => string | null) | null = null;
  let respond: () => Response = () => new Response(JSON.stringify({ key: { id: "NEW-ID" } }), { status: 201 });

  test.beforeEach(() => {
    process.env.EVOLUTION_API_URL = "http://evolution.test:8080/";
    process.env.EVOLUTION_API_KEY = "secret_key_123";
    calls = [];
    lookups = [];
    lookupJid = null;
    respond = () => new Response(JSON.stringify({ key: { id: "NEW-ID" } }), { status: 201 });
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      // POST /chat/whatsappNumbers: confirma o JID real do chat. Por padrão devolve o mesmo JID (nada muda).
      if (String(url).includes("/chat/whatsappNumbers/")) {
        const numbers = (JSON.parse(String(init.body)) as { numbers: string[] }).numbers;
        lookups.push({ url: String(url), numbers });
        const real = lookupJid ? lookupJid(numbers[0]) : `${numbers[0]}@s.whatsapp.net`;
        return new Response(JSON.stringify(real ? [{ exists: true, jid: real, number: numbers[0] }] : [{ exists: false, number: numbers[0] }]), { status: 200 });
      }
      calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)), apikey: (init.headers as Record<string, string>).apikey ?? null });
      return respond();
    }) as typeof fetch;
  });
  test.afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("responder: sendText e sendMedia levam o quoted (key + message) quando há citação, e nada quando não há", async () => {
    const quoted = { externalMessageId: "ORIG", remoteJid: "5582988880000@s.whatsapp.net", fromMe: false, text: "pergunta" };
    await gatewayModule.sendEvolutionTextMessage("inst", "5582988880000@s.whatsapp.net", "resposta", undefined, quoted);
    await gatewayModule.sendEvolutionMedia("inst", "5582988880000@s.whatsapp.net", { mediatype: "document", mimetype: "application/pdf", fileName: "a.pdf", mediaUrl: "http://x/y" }, undefined, quoted);
    await gatewayModule.sendEvolutionTextMessage("inst", "5582988880000@s.whatsapp.net", "sem citação");
    expect(calls[0].body.quoted).toEqual({ key: { id: "ORIG", remoteJid: "5582988880000@s.whatsapp.net", fromMe: false }, message: { conversation: "pergunta" } });
    expect(calls[1].body.quoted).toEqual(calls[0].body.quoted);
    expect("quoted" in calls[2].body).toBe(false);
  });

  test("editar, apagar para todos e reagir: rota, método e corpo conforme a Evolution v2.3.7", async () => {
    const jid = "5582988880000@s.whatsapp.net";
    await actionsGateway.editEvolutionMessage("inst", jid, "MSG-1", "texto novo");
    await actionsGateway.deleteEvolutionMessageForEveryone("inst", jid, "MSG-1");
    await actionsGateway.sendEvolutionReaction("inst", jid, "MSG-1", false, "👍");
    await actionsGateway.sendEvolutionReaction("inst", jid, "MSG-1", false, "");
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /chat/updateMessage/inst",
      "DELETE /chat/deleteMessageForEveryone/inst",
      "POST /message/sendReaction/inst",
      "POST /message/sendReaction/inst",
    ]);
    expect(calls[0].body).toEqual({ number: "5582988880000", key: { remoteJid: jid, fromMe: true, id: "MSG-1" }, text: "texto novo" });
    expect(calls[1].body).toEqual({ id: "MSG-1", remoteJid: jid, fromMe: true });
    expect(calls[2].body).toEqual({ key: { remoteJid: jid, fromMe: false, id: "MSG-1" }, reaction: "👍" });
    expect(calls[3].body.reaction).toBe("");
    expect(calls.every((call) => call.apikey === "secret_key_123")).toBe(true);
  });

  test("JID real: conversa com o 9º dígito no JID guardado e sem ele no WhatsApp usa o JID REAL na chave de editar, apagar e reagir", async () => {
    // O ImobFlux guarda 5582999990000 (13 dígitos); o WhatsApp do contato usa 558299990000 (12 dígitos, sem o 9).
    lookupJid = (digits) => (digits === "5582999990000" ? "558299990000@s.whatsapp.net" : null);
    const stored = "5582999990000@s.whatsapp.net";
    await actionsGateway.editEvolutionMessage("inst", stored, "MSG-9", "novo texto");
    await actionsGateway.deleteEvolutionMessageForEveryone("inst", stored, "MSG-9");
    await actionsGateway.sendEvolutionReaction("inst", stored, "MSG-9", true, "👍");
    expect(lookups.length).toBeGreaterThanOrEqual(1);
    expect(lookups[0].numbers).toEqual(["5582999990000"]);
    expect(new URL(lookups[0].url).pathname).toBe("/chat/whatsappNumbers/inst");
    const real = "558299990000@s.whatsapp.net";
    expect((calls[0].body.key as { remoteJid: string }).remoteJid).toBe(real);
    expect(calls[0].body.number).toBe("558299990000");
    expect(calls[1].body.remoteJid).toBe(real);
    expect((calls[2].body.key as { remoteJid: string }).remoteJid).toBe(real);
  });

  test("JID real: se a consulta falha ou não acha o número, usa o JID guardado (nada quebra)", async () => {
    const stored = "5582988881111@s.whatsapp.net";
    lookupJid = () => null;
    await actionsGateway.deleteEvolutionMessageForEveryone("inst", stored, "M1");
    expect(calls[0].body.remoteJid).toBe(stored);
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      if (String(url).includes("/chat/whatsappNumbers/")) return new Response("erro", { status: 500 });
      return baseFetch(url, init);
    }) as typeof fetch;
    await actionsGateway.deleteEvolutionMessageForEveryone("inst", "5582988882222@s.whatsapp.net", "M2");
    expect(calls[1].body.remoteJid).toBe("5582988882222@s.whatsapp.net");
  });

  test("JID real: grupo e @lid não são consultados (já são a chave real)", async () => {
    await actionsGateway.deleteEvolutionMessageForEveryone("inst", "120363000000000000@g.us", "M3");
    await actionsGateway.deleteEvolutionMessageForEveryone("inst", "98765432109876@lid", "M4");
    expect(lookups).toHaveLength(0);
    expect(calls[0].body.remoteJid).toBe("120363000000000000@g.us");
    expect(calls[1].body.remoteJid).toBe("98765432109876@lid");
  });

  test("áudio de voz: sendWhatsAppAudio com encoding e a URL assinada; sem id na resposta é falha", async () => {
    const ok = await actionsGateway.sendEvolutionVoiceNote("inst", "5582988880000@s.whatsapp.net", "http://storage/sign?token=abc");
    expect(ok).toEqual({ success: true, externalMessageId: "NEW-ID" });
    expect(new URL(calls[0].url).pathname).toBe("/message/sendWhatsAppAudio/inst");
    expect(calls[0].body).toEqual({ number: "5582988880000", audio: "http://storage/sign?token=abc", encoding: true });
    respond = () => new Response(JSON.stringify({}), { status: 201 });
    expect(await actionsGateway.sendEvolutionVoiceNote("inst", "5582988880000@s.whatsapp.net", "http://x")).toMatchObject({ success: false, code: "MISSING_EXTERNAL_ID" });
  });

  test("erros: só código curto e frase fixa (nunca o corpo da resposta, o texto, o número nem a chave)", async () => {
    respond = () => new Response(JSON.stringify({ message: "segredo do servidor 5582988880000" }), { status: 400 });
    const failed = await actionsGateway.editEvolutionMessage("inst", "5582988880000@s.whatsapp.net", "MSG-1", "texto privado");
    expect(failed).toEqual({ success: false, error: "Evolution API retornou erro HTTP 400", code: "HTTP_400" });
    expect(JSON.stringify(failed)).not.toMatch(/segredo|privado|5582988880000|secret_key/);
    globalThis.fetch = (async () => {
      throw new Error("boom com http://evolution.test:8080");
    }) as typeof fetch;
    const network = await actionsGateway.sendEvolutionReaction("inst", "5582988880000@s.whatsapp.net", "M", false, "👍");
    expect(network).toMatchObject({ success: false, code: "NETWORK_ERROR" });
    expect(JSON.stringify(network)).not.toContain("evolution.test");
    // Sem instância / destino inválido / sem configuração.
    delete process.env.EVOLUTION_INSTANCE_NAME;
    expect(await actionsGateway.deleteEvolutionMessageForEveryone("", "5582988880000@s.whatsapp.net", "M")).toMatchObject({ code: "MISSING_INSTANCE" });
    expect(await actionsGateway.deleteEvolutionMessageForEveryone("inst", "sem-arroba", "M")).toMatchObject({ code: "INVALID_PHONE" });
    delete process.env.EVOLUTION_API_URL;
    expect(await actionsGateway.sendEvolutionReaction("inst", "5582988880000@s.whatsapp.net", "M", false, "👍")).toMatchObject({ code: "MISSING_ENV_CONFIG" });
  });
});

test.describe("Pacote de mensagens — auditoria", () => {
  const event = (action: string, metadata: Record<string, unknown> = {}): AuditEventRow => ({
    id: "11111111-1111-4111-8111-111111111111",
    occurred_at: "2026-10-15T12:00:00.000Z",
    action,
    target_type: "message",
    target_id: "11111111-1111-4111-8111-111111111111",
    result: "success",
    actor_type: "member",
    actor_member_id: null,
    actor_name: "Ana",
    metadata,
  });

  test("editar, apagar, esconder, restaurar, encaminhar e notas têm rótulo próprio e nunca mostram texto de mensagem", () => {
    const actions = ["message.edited", "message.deleted_for_everyone", "message.hidden", "message.restored", "message.forwarded", "conversation.note_edited", "conversation.note_deleted"];
    for (const action of actions) {
      const view = describeAuditEvent(event(action, { source: "crm", text: "texto privado do cliente", note_id: "x" }));
      expect(view.title).not.toBe(action);
      expect(JSON.stringify(view)).not.toContain("texto privado");
    }
    expect(categoryOf("message.edited")).toBe("message");
    expect(categoryOf("conversation.note_deleted")).toBe("conversation");
  });
});
