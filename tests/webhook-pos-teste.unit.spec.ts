import { expect, test } from "@playwright/test";
import { describeShape, webhookShapeLine } from "../lib/conversations/webhook-shape";
import { extractQuoted, normalizeEventName, parseEvolutionWebhookPayload } from "../lib/conversations/webhook";

// Fixtures ANONIMIZADAS no formato em que a Evolution v2 entrega edição, exclusão, reação e resposta citada. O que não deu para
// capturar de produção (os logs expiram em 30 min no plano atual) foi montado a partir do contrato do Baileys/Evolution; o
// parser aceita as variantes e ignora o desconhecido sem erro. Os payloads reais entram aqui depois do reteste com o log
// "[webhook-shape]" (só a forma, sem valores).

const JID = "5582900000000@s.whatsapp.net";
const base = (event: string, data: Record<string, unknown>) => ({ event, instance: "inst", data });
const key = (extra: Record<string, unknown> = {}) => ({ remoteJid: JID, fromMe: true, id: "EDIT-OR-REVOKE-MSG-ID", ...extra });

test.describe("Webhook — edição vinda do celular", () => {
  const edited = { conversation: "texto novo" };
  const variants: Array<[string, unknown]> = [
    ["messages.upsert com protocolMessage MESSAGE_EDIT (texto)", base("messages.upsert", { key: key(), message: { protocolMessage: { type: "MESSAGE_EDIT", key: key({ id: "ORIG-1" }), editedMessage: edited, timestampMs: 1760000000000 } } })],
    ["tipo numérico 14", base("messages.upsert", { key: key(), message: { protocolMessage: { type: 14, key: key({ id: "ORIG-1" }), editedMessage: edited } } })],
    ["evento em maiúsculas (MESSAGES_EDITED)", base("MESSAGES_EDITED", { key: key(), message: { protocolMessage: { type: 14, key: key({ id: "ORIG-1" }), editedMessage: edited } } })],
    ["envelope editedMessage.message.protocolMessage", base("messages.edited", { key: key(), message: { editedMessage: { message: { protocolMessage: { type: "MESSAGE_EDIT", key: key({ id: "ORIG-1" }), editedMessage: edited } } } } })],
    ["texto estendido", base("messages.upsert", { key: key(), message: { protocolMessage: { type: 14, key: key({ id: "ORIG-1" }), editedMessage: { extendedTextMessage: { text: "texto novo" } } } } })],
    ["embrulhado em deviceSentMessage (celular da própria conta)", base("messages.upsert", { key: key(), message: { deviceSentMessage: { destinationJid: JID, message: { protocolMessage: { type: 14, key: key({ id: "ORIG-1" }), editedMessage: edited } } } } })],
    ["embrulhado em ephemeralMessage", base("messages.upsert", { key: key(), message: { ephemeralMessage: { message: { protocolMessage: { type: 14, key: key({ id: "ORIG-1" }), editedMessage: edited } } } } })],
    ["editedMessage com a mensagem de texto estendido dentro de um envelope", base("messages.edited", { key: key(), message: { editedMessage: { message: { protocolMessage: { type: 14, key: key({ id: "ORIG-1" }), editedMessage: { extendedTextMessage: { text: "texto novo" } } } } } } })],
  ];
  for (const [name, payload] of variants) {
    test(`reconhece: ${name}`, () => {
      expect(parseEvolutionWebhookPayload(payload)).toMatchObject({ status: "edit", instance: "inst", externalMessageId: "ORIG-1", newText: "texto novo" });
    });
  }

  test("a hora da edição vem de timestampMs; sem ela fica nula", () => {
    const withTime = parseEvolutionWebhookPayload(variants[0][1]);
    expect(withTime).toMatchObject({ status: "edit", editedAt: new Date(1760000000000).toISOString() });
    expect(parseEvolutionWebhookPayload(variants[1][1])).toMatchObject({ status: "edit", editedAt: null });
  });

  test("edição sem texto ou de tipo desconhecido é ignorada sem erro (e nunca vira mensagem nova)", () => {
    expect(parseEvolutionWebhookPayload(base("messages.upsert", { key: key(), message: { protocolMessage: { type: 14, key: key({ id: "X" }), editedMessage: {} } } }))).toMatchObject({ status: "ignored" });
    expect(parseEvolutionWebhookPayload(base("messages.upsert", { key: key(), message: { protocolMessage: { type: "HISTORY_SYNC_NOTIFICATION" } } }))).toMatchObject({ status: "ignored" });
    expect(parseEvolutionWebhookPayload(base("messages.upsert", { key: key(), message: { protocolMessage: { type: 14 } } }))).toMatchObject({ status: "ignored" });
  });
});

test.describe("Webhook — exclusão vinda do celular", () => {
  const variants: Array<[string, unknown]> = [
    ["protocolMessage REVOKE (texto)", base("messages.upsert", { key: key(), message: { protocolMessage: { type: "REVOKE", key: key({ id: "ORIG-2" }) } } })],
    ["tipo numérico 0", base("messages.upsert", { key: key(), message: { protocolMessage: { type: 0, key: key({ id: "ORIG-2" }) } } })],
    ["evento messages.delete com key.id", base("messages.delete", { key: key({ id: "ORIG-2" }) })],
    ["evento MESSAGES_DELETE com id solto", base("MESSAGES_DELETE", { id: "ORIG-2" })],
    ["embrulhado em deviceSentMessage", base("messages.upsert", { key: key(), message: { deviceSentMessage: { destinationJid: JID, message: { protocolMessage: { type: 0, key: key({ id: "ORIG-2" }) } } } } })],
    ["feito pelo cliente (fromMe falso)", base("messages.upsert", { key: key({ fromMe: false }), message: { protocolMessage: { type: "REVOKE", key: key({ id: "ORIG-2", fromMe: false }) } } })],
  ];
  for (const [name, payload] of variants) {
    test(`reconhece: ${name}`, () => {
      expect(parseEvolutionWebhookPayload(payload)).toEqual({ status: "revoke", instance: "inst", externalMessageId: "ORIG-2" });
    });
  }
  test("messages.delete sem identificador é ignorado sem erro", () => {
    expect(parseEvolutionWebhookPayload(base("messages.delete", {}))).toMatchObject({ status: "ignored" });
  });
});

test.describe("Webhook — reação", () => {
  test("do celular da conta, do cliente, remoção e @lid com telefone alternativo", () => {
    const own = base("messages.upsert", { key: key({ id: "REACTION-EVENT" }), message: { reactionMessage: { key: key({ id: "TARGET-1" }), text: "❤️" } } });
    expect(parseEvolutionWebhookPayload(own)).toMatchObject({ status: "reaction", targetExternalId: "TARGET-1", fromMe: true, reactorJid: "", emoji: "❤️" });
    const client = base("messages.upsert", { key: key({ id: "R", fromMe: false }), message: { reactionMessage: { key: key({ id: "TARGET-1", fromMe: true }), text: "👍" } } });
    expect(parseEvolutionWebhookPayload(client)).toMatchObject({ status: "reaction", fromMe: false, reactorJid: JID, emoji: "👍" });
    const removal = base("messages.upsert", { key: key({ id: "R", fromMe: false }), message: { reactionMessage: { key: key({ id: "TARGET-1" }), text: "" } } });
    expect(parseEvolutionWebhookPayload(removal)).toMatchObject({ status: "reaction", emoji: "" });
    const lid = base("messages.upsert", { key: { remoteJid: "123456789012345@lid", remoteJidAlt: JID, fromMe: false, id: "R" }, message: { reactionMessage: { key: key({ id: "TARGET-1" }), text: "😂" } } });
    expect(parseEvolutionWebhookPayload(lid)).toMatchObject({ status: "reaction", reactorJid: JID });
  });
  test("reação em grupo e sem alvo é ignorada", () => {
    const group = base("messages.upsert", { key: { remoteJid: "120363000000000000@g.us", fromMe: false, id: "R", participant: JID }, message: { reactionMessage: { key: { id: "T" }, text: "👍" } } });
    expect(parseEvolutionWebhookPayload(group)).toMatchObject({ status: "ignored" });
    expect(parseEvolutionWebhookPayload(base("messages.upsert", { key: key(), message: { reactionMessage: { text: "👍" } } }))).toMatchObject({ status: "ignored" });
  });
});

test.describe("Webhook — resposta citada (cliente e celular)", () => {
  const quotedText = { stanzaId: "QUOTED-ID", participant: JID, quotedMessage: { conversation: "texto citado" } };

  test("resposta de texto estendido pelo celular (fromMe) e pelo cliente", () => {
    for (const fromMe of [true, false]) {
      const payload = base("messages.upsert", { key: key({ fromMe, id: "NEW-1" }), message: { extendedTextMessage: { text: "minha resposta", contextInfo: quotedText } }, messageTimestamp: 1760000000 });
      const result = parseEvolutionWebhookPayload(payload);
      expect(result).toMatchObject({ status: "valid", textContent: "minha resposta", fromMe, quoted: { externalId: "QUOTED-ID", text: "texto citado", hasMedia: false } });
    }
  });

  test("contextInfo no nível do evento (data.contextInfo), sem estar dentro da mensagem", () => {
    const payload = base("messages.upsert", { key: key({ id: "NEW-2" }), message: { conversation: "resposta simples" }, contextInfo: quotedText, messageTimestamp: 1760000000 });
    expect(parseEvolutionWebhookPayload(payload)).toMatchObject({ status: "valid", textContent: "resposta simples", quoted: { externalId: "QUOTED-ID", text: "texto citado" } });
  });

  test("resposta de mídia: imagem, vídeo, documento, áudio e figurinha carregam a citação", () => {
    for (const type of ["imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage"]) {
      const payload = base("messages.upsert", { key: key({ id: "NEW-3" }), message: { [type]: { mimetype: "x/y", caption: type === "imageMessage" ? "legenda" : undefined, contextInfo: quotedText } }, messageTimestamp: 1760000000 });
      const result = parseEvolutionWebhookPayload(payload);
      expect(result, type).toMatchObject({ status: "valid", quoted: { externalId: "QUOTED-ID" } });
    }
  });

  test("a mensagem original pode ser mídia (legenda como trecho) ou texto estendido", () => {
    const image = extractQuoted({ extendedTextMessage: { text: "r", contextInfo: { stanzaId: "Q", quotedMessage: { imageMessage: { caption: "foto do imóvel" } } } } });
    expect(image).toEqual({ externalId: "Q", text: "foto do imóvel", hasMedia: true });
    const extended = extractQuoted({ extendedTextMessage: { text: "r", contextInfo: { stanzaId: "Q", quotedMessage: { extendedTextMessage: { text: "link https://x" } } } } });
    expect(extended).toEqual({ externalId: "Q", text: "link https://x", hasMedia: false });
    const sticker = extractQuoted({ extendedTextMessage: { text: "r", contextInfo: { stanzaId: "Q", quotedMessage: { stickerMessage: {} } } } });
    expect(sticker).toEqual({ externalId: "Q", text: null, hasMedia: true });
  });

  test("mensagem embrulhada (efêmera, enviada por outro aparelho, visualização única) também traz a citação e o texto", () => {
    const wrapped = base("messages.upsert", {
      key: key({ id: "NEW-4" }),
      message: { deviceSentMessage: { destinationJid: JID, message: { ephemeralMessage: { message: { extendedTextMessage: { text: "resposta embrulhada", contextInfo: quotedText } } } } } },
      messageTimestamp: 1760000000,
    });
    expect(parseEvolutionWebhookPayload(wrapped)).toMatchObject({ status: "valid", textContent: "resposta embrulhada", quoted: { externalId: "QUOTED-ID" } });
  });

  test("sem stanzaId não há citação; o texto da mensagem segue normal", () => {
    const payload = base("messages.upsert", { key: key({ id: "NEW-5" }), message: { extendedTextMessage: { text: "só texto", contextInfo: { quotedMessage: { conversation: "x" } } } }, messageTimestamp: 1760000000 });
    expect(parseEvolutionWebhookPayload(payload)).toMatchObject({ status: "valid", textContent: "só texto", quoted: null });
  });

  test("mensagem comum e histórico não ganham citação", () => {
    expect(parseEvolutionWebhookPayload(base("messages.upsert", { key: key({ id: "N" }), message: { conversation: "oi" }, messageTimestamp: 1760000000 }))).toMatchObject({ status: "valid", quoted: null });
  });
});

test.describe("Webhook — formas REAIS de produção (log [webhook-shape] de 16/10, valores anonimizados)", () => {
  const realKey = (extra: Record<string, unknown> = {}) => ({ remoteJid: "123456789012345@lid", remoteJidAlt: JID, fromMe: true, id: "REAL-ID", participant: "", addressingMode: "lid", ...extra });

  test("resposta do celular: contextInfo no nível do evento (com mentionedJid, quotedType...) e mensagem só com conversation", () => {
    const payload = base("messages.upsert", {
      key: realKey(),
      pushName: "Nome",
      status: "SERVER_ACK",
      message: { conversation: "resposta do celular" },
      contextInfo: { mentionedJid: [], groupMentions: [], statusAttributions: [], stanzaId: "ORIG-REAL", participant: JID, quotedMessage: { conversation: "texto citado" }, quotedType: 0 },
      messageType: "conversation",
      messageTimestamp: 1760000000,
      instanceId: "x",
      source: "android",
    });
    expect(parseEvolutionWebhookPayload(payload)).toMatchObject({ status: "valid", fromMe: true, quoted: { externalId: "ORIG-REAL", text: "texto citado" } });
  });

  test("reação do celular com remoteJid @lid + remoteJidAlt e senderTimestampMs como Long", () => {
    const payload = base("messages.upsert", {
      key: realKey({ id: "REACT-EVENT" }),
      message: { reactionMessage: { key: { remoteJid: JID, fromMe: false, id: "ALVO" }, text: "❤️", senderTimestampMs: { low: 1, high: 2, unsigned: false } } },
      messageType: "reactionMessage",
      messageTimestamp: 1760000000,
    });
    expect(parseEvolutionWebhookPayload(payload)).toMatchObject({ status: "reaction", targetExternalId: "ALVO", fromMe: true, emoji: "❤️" });
  });

  test("secretEncryptedMessage de edição (tipo 2) vira sinal de edição, nunca mensagem nova", () => {
    const payload = base("messages.upsert", {
      key: realKey({ id: "SECRET-EVENT" }),
      message: { secretEncryptedMessage: { targetMessageKey: { remoteJid: JID, fromMe: true, id: "ALVO" }, encPayload: { 0: 1, 1: 2 }, encIv: { 0: 1 }, secretEncType: 2 } },
      messageType: "secretEncryptedMessage",
      messageTimestamp: 1760000000,
    });
    expect(parseEvolutionWebhookPayload(payload)).toMatchObject({ status: "edit_signal", externalMessageId: "ALVO" });
  });
});

test.describe("Webhook — messages.update (recibos e, se a Evolution mandar, edição/exclusão)", () => {
  test("recibo de entrega/leitura é ignorado em silêncio", () => {
    expect(parseEvolutionWebhookPayload(base("messages.update", { messageId: "x", keyId: "K1", remoteJid: JID, fromMe: true, status: "DELIVERY_ACK" }))).toEqual({ status: "ignored", reason: "status_update" });
    expect(parseEvolutionWebhookPayload(base("MESSAGES_UPDATE", { keyId: "K1", status: "READ" }))).toMatchObject({ reason: "status_update" });
  });
  test("status DELETED com keyId vira exclusão", () => {
    expect(parseEvolutionWebhookPayload(base("messages.update", { keyId: "K1", remoteJid: JID, fromMe: true, status: "DELETED" }))).toEqual({ status: "revoke", instance: "inst", externalMessageId: "K1" });
  });
  test("update com protocolMessage/editedMessage dentro vira edição ou exclusão", () => {
    const edit = base("messages.update", { key: key({ id: "UPD" }), message: { protocolMessage: { type: 14, key: key({ id: "ORIG-9" }), editedMessage: { conversation: "novo" } } } });
    expect(parseEvolutionWebhookPayload(edit)).toMatchObject({ status: "edit", externalMessageId: "ORIG-9", newText: "novo" });
    const revoke = base("messages.update", { key: key({ id: "UPD" }), message: { protocolMessage: { type: "REVOKE", key: key({ id: "ORIG-9" }) } } });
    expect(parseEvolutionWebhookPayload(revoke)).toMatchObject({ status: "revoke", externalMessageId: "ORIG-9" });
  });
});

test.describe("Webhook — robustez e diagnóstico sem conteúdo", () => {
  test("eventos desconhecidos e formatos estranhos nunca quebram", () => {
    expect(parseEvolutionWebhookPayload(base("presence.update", { id: "x" }))).toMatchObject({ status: "ignored", reason: "unhandled_event" });
    expect(parseEvolutionWebhookPayload(base("messages.upsert", { key: key(), message: { pollCreationMessage: { name: "enquete" } }, messageTimestamp: 1760000000 }))).toMatchObject({ status: "ignored" });
    expect(parseEvolutionWebhookPayload(null)).toMatchObject({ status: "malformed" });
    expect(parseEvolutionWebhookPayload([])).toMatchObject({ status: "malformed" });
    expect(parseEvolutionWebhookPayload(base("messages.upsert", { key: key(), message: "texto" }))).toMatchObject({ status: "ignored" });
  });

  test("nome do evento: maiúsculas, underline e hífen valem", () => {
    expect(normalizeEventName("MESSAGES_UPSERT")).toBe("messages.upsert");
    expect(normalizeEventName("messages-edited")).toBe("messages.edited");
    expect(normalizeEventName(" connection.update ")).toBe("connection.update");
  });

  test("a descrição da forma mostra chaves e tipos, NUNCA valores (texto, número, nome)", () => {
    const payload = base("messages.upsert", {
      key: { remoteJid: "5582977776666@s.whatsapp.net", fromMe: true, id: "ID-SECRETO-123" },
      pushName: "Maria da Silva",
      message: { extendedTextMessage: { text: "senha 1234 do cliente", contextInfo: { stanzaId: "STANZA-ABC", quotedMessage: { conversation: "texto citado privado" } } } },
    });
    const line = webhookShapeLine("messages.upsert", "quoted", (payload as { data: unknown }).data);
    expect(line).toContain("remoteJid:s");
    expect(line).toContain("fromMe:b");
    expect(line).toContain("stanzaId:s");
    for (const secret of ["5582977776666", "ID-SECRETO", "Maria", "senha 1234", "STANZA-ABC", "texto citado privado"]) {
      expect(line).not.toContain(secret);
    }
    expect(describeShape({ a: [1, 2], b: null, c: { d: "x" } })).toBe("{a:arr(2)[n],b:null,c:{d:s}}");
  });

  test("a linha de diagnóstico é curta e o nome do evento não carrega caracteres estranhos", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 30; i += 1) {
      const next: Record<string, unknown> = { [`k${i}`]: "valor" };
      cursor.n = next;
      cursor = next;
    }
    const line = webhookShapeLine("messages.upsert\nINJECT", "edit", deep);
    expect(line.length).toBeLessThan(2000);
    expect(line).not.toContain("\n");
    expect(line).toContain("event=messages.upsertINJECT");
  });
});

test.describe("Webhook — edição SEM texto (formas reais do reteste de 16/10)", () => {
  const secret = (type: number | string, extra: Record<string, unknown> = {}) =>
    base("messages.upsert", {
      key: { remoteJid: "123456789012345@lid", remoteJidAlt: JID, fromMe: true, id: "SECRET-EVENT", participant: "", addressingMode: "lid" },
      message: { secretEncryptedMessage: { targetMessageKey: { remoteJid: JID, fromMe: true, id: "ALVO-EDIT" }, encPayload: { 0: 1 }, encIv: { 0: 1 }, secretEncType: type, ...extra } },
      messageType: "secretEncryptedMessage",
      messageTimestamp: 1760000000,
    });

  test("secretEncryptedMessage de edição (tipo 2) vira sinal de edição com o id da mensagem alvo", () => {
    expect(parseEvolutionWebhookPayload(secret(2))).toEqual({ status: "edit_signal", instance: "inst", externalMessageId: "ALVO-EDIT", remoteJid: JID });
    expect(parseEvolutionWebhookPayload(secret("MESSAGE_EDIT"))).toMatchObject({ status: "edit_signal", externalMessageId: "ALVO-EDIT" });
  });

  test("outros tipos de secretEncryptedMessage (evento, enquete) e sem alvo continuam ignorados", () => {
    expect(parseEvolutionWebhookPayload(secret(1))).toMatchObject({ status: "ignored" });
    expect(parseEvolutionWebhookPayload(secret(0))).toMatchObject({ status: "ignored" });
    const noTarget = base("messages.upsert", { key: key({ id: "X" }), message: { secretEncryptedMessage: { secretEncType: 2 } } });
    expect(parseEvolutionWebhookPayload(noTarget)).toMatchObject({ status: "ignored" });
  });

  test("messages.edited só com { key, type } (sem texto) vira sinal de edição; com texto continua sendo edição normal", () => {
    expect(parseEvolutionWebhookPayload(base("messages.edited", { key: { remoteJid: JID, fromMe: true, id: "ALVO-2" }, type: "MESSAGE_EDIT" })))
      .toEqual({ status: "edit_signal", instance: "inst", externalMessageId: "ALVO-2", remoteJid: JID });
    expect(parseEvolutionWebhookPayload(base("messages.edited", { key: key({ id: "EV" }), message: { protocolMessage: { type: 14, key: key({ id: "ALVO-3" }), editedMessage: { conversation: "texto" } } } })))
      .toMatchObject({ status: "edit", externalMessageId: "ALVO-3", newText: "texto" });
    expect(parseEvolutionWebhookPayload(base("messages.edited", { type: "x" })).status).not.toBe("edit_signal");
  });

  test("messages.delete no formato PLANO real ({ remoteJid, fromMe, id, status... }) é exclusão", () => {
    expect(parseEvolutionWebhookPayload(base("messages.delete", { remoteJid: "1@lid", remoteJidAlt: JID, fromMe: false, id: "ALVO-DEL", participant: "", addressingMode: "lid", status: "DELETED" })))
      .toEqual({ status: "revoke", instance: "inst", externalMessageId: "ALVO-DEL" });
  });
});
