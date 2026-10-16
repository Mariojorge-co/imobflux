import { createHash, timingSafeEqual } from "node:crypto";

export type WebhookMediaKind = "image" | "document" | "audio" | "video" | "sticker";

/** Metadados de uma mensagem de mídia (o binário ainda não é baixado). */
export type WebhookMedia = {
  kind: WebhookMediaKind;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  /** Arquivo em base64 quando a Evolution está configurada para enviá-lo no webhook. */
  inlineBase64: string | null;
};

/** Uma mensagem de histórico pronta para a RPC de importação (mídia vira só o rótulo em texto). */
export type HistoryMessageItem = {
  external_message_id: string;
  remote_jid: string;
  sender_jid: string | null;
  from_me: boolean;
  push_name: string | null;
  text_content: string;
  occurred_at: string;
};

/** Janela de importação: mensagens mais antigas que isso não entram. */
export const HISTORY_WINDOW_DAYS = 15;
/** Tamanho de cada chamada ao banco (a RPC aceita até 1000). */
export const HISTORY_CHUNK_SIZE = 500;

export type WebhookHistoryResult = {
  status: "history";
  instance: string;
  items: HistoryMessageItem[];
  /** Total de mensagens recebidas no lote (antes de qualquer filtro). */
  received: number;
  /** Fora da janela de 15 dias, sem texto reconhecido, sem data ou de transmissão/canal. */
  skipped: number;
  isLatest: boolean;
  progress: number | null;
};

export type WebhookParseResult =
  | { status: "invalid_secret"; error: string }
  | { status: "malformed"; error: string }
  | { status: "ignored"; reason: "unhandled_event" | "status_update" | "group_sender_missing" | "non_text_message_ignored" | "missing_timestamp" | "broadcast_or_channel" }
  | { status: "connection"; instance: string; state: "open" | "close" | null }
  | WebhookHistoryResult
  | { status: "edit"; instance: string; externalMessageId: string; newText: string; editedAt: string | null }
  | { status: "revoke"; instance: string; externalMessageId: string }
  | { status: "reaction"; instance: string; targetExternalId: string; reactorJid: string; fromMe: boolean; emoji: string }
  | {
      status: "valid";
      instance: string;
      remoteJid: string;
      conversationType: "individual" | "group";
      senderJid: string | null;
      groupSubject: string | null;
      fromMe: boolean;
      externalMessageId: string | null;
      pushName: string | null;
      /** Texto ou legenda; em mídia sem legenda, um rótulo legível ("📄 Documento: x.pdf"). */
      textContent: string;
      media: WebhookMedia | null;
      occurredAt: string;
      /** O cliente (ou o celular) respondeu a esta mensagem: id dela no WhatsApp e o trecho que veio no evento. */
      quoted: WebhookQuoted | null;
    };

/** Mensagem citada numa resposta recebida. */
export type WebhookQuoted = {
  externalId: string;
  text: string | null;
  hasMedia: boolean;
};

interface EvolutionPayloadKey {
  remoteJid?: string;
  participant?: string;
  fromMe?: boolean;
  id?: string;
}

type EvolutionMediaMessage = {
  mimetype?: unknown;
  fileName?: unknown;
  title?: unknown;
  caption?: unknown;
  fileLength?: unknown;
  ptt?: unknown;
  contextInfo?: EvolutionContextInfo;
};

type EvolutionContextInfo = {
  stanzaId?: unknown;
  quotedMessage?: Record<string, unknown>;
};

type EvolutionProtocolMessage = {
  type?: unknown;
  key?: EvolutionPayloadKey;
  editedMessage?: { conversation?: unknown; extendedTextMessage?: { text?: unknown } };
  timestampMs?: unknown;
};

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: {
    text?: string;
    contextInfo?: EvolutionContextInfo;
  };
  reactionMessage?: { key?: EvolutionPayloadKey; text?: unknown };
  protocolMessage?: EvolutionProtocolMessage;
  /** Envelope de edição: a edição vem aninhada em `editedMessage.message.protocolMessage`. */
  editedMessage?: { message?: { protocolMessage?: EvolutionProtocolMessage } };
  imageMessage?: EvolutionMediaMessage;
  documentMessage?: EvolutionMediaMessage;
  documentWithCaptionMessage?: { message?: { documentMessage?: EvolutionMediaMessage } };
  audioMessage?: EvolutionMediaMessage;
  videoMessage?: EvolutionMediaMessage;
  stickerMessage?: EvolutionMediaMessage;
  base64?: unknown;
}

interface EvolutionPayloadData {
  state?: unknown;
  key?: EvolutionPayloadKey;
  pushName?: string;
  subject?: string;
  message?: EvolutionMessageContent;
  base64?: unknown;
  messageTimestamp?: number | string;
}

interface EvolutionPayload {
  event?: string;
  instance?: string;
  data?: EvolutionPayloadData;
}

function secretDigest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Valida o secret do webhook enviado no header X-Evolution-Secret.
 * Falha fechado: sem secret configurado no servidor, toda requisição é rejeitada.
 * Compara digests SHA-256 (mesmo tamanho) em tempo constante.
 */
export function validateWebhookSecret(
  incomingSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret || !incomingSecret) {
    return false;
  }
  return timingSafeEqual(secretDigest(incomingSecret), secretDigest(expectedSecret));
}

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;
}

/** Nomes de evento chegam como "messages.upsert", "MESSAGES_UPSERT" ou "messages-upsert": tudo vira "messages.upsert". */
export function normalizeEventName(event: string): string {
  return event.trim().toLowerCase().replace(/[_-]/g, ".");
}

// Envelopes em que o WhatsApp embrulha a mensagem de verdade (efêmera, visualização única, enviada por outro aparelho da
// própria conta, documento com legenda e a edição). Cada um guarda a mensagem interna em `.message`.
const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "deviceSentMessage",
  "documentWithCaptionMessage",
  "editedMessage",
];

/** A mensagem e as camadas embrulhadas dentro dela, da mais externa para a mais interna (no máximo 6). */
export function messageLayers(message: unknown): Loose[] {
  const layers: Loose[] = [];
  let current = asObject(message);
  for (let depth = 0; current && depth < 6; depth += 1) {
    layers.push(current);
    let next: Loose | null = null;
    for (const key of WRAPPER_KEYS) {
      const inner = asObject(asObject(current[key])?.message);
      if (inner) {
        next = inner;
        break;
      }
    }
    current = next;
  }
  return layers;
}

/** Primeiro texto ou legenda encontrado nas camadas (texto simples, texto estendido ou legenda de mídia). */
export function textFromLayers(message: unknown): string | null {
  for (const layer of messageLayers(message)) {
    const direct = cleanString(layer.conversation) ?? cleanString(asObject(layer.extendedTextMessage)?.text);
    if (direct) return direct;
    for (const key of ["imageMessage", "videoMessage", "documentMessage"]) {
      const caption = cleanString(asObject(layer[key])?.caption);
      if (caption) return caption;
    }
  }
  return null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** fileLength vem como número, texto numérico ou objeto Long ({ low, high }). */
function parseFileLength(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 && Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const { low, high } = value as { low?: unknown; high?: unknown };
    if (typeof low === "number" && (high === undefined || high === 0)) {
      return low > 0 ? low : null;
    }
  }
  return null;
}

const MEDIA_LABELS: Record<WebhookMediaKind, string> = {
  image: "📷 Imagem",
  document: "📄 Documento",
  audio: "🎧 Áudio",
  video: "🎬 Vídeo",
  sticker: "Figurinha",
};

/**
 * Extrai o tipo de mídia suportado (imagem, documento/PDF, áudio, vídeo, figurinha) e
 * seus metadados. Retorna null para mensagens sem mídia reconhecida.
 */
export function extractWebhookMedia(
  message: EvolutionMessageContent | undefined,
): { media: WebhookMedia; caption: string | null; label: string } | null {
  if (!message) return null;

  const candidates: Array<[WebhookMediaKind, EvolutionMediaMessage | undefined]> = [
    ["image", message.imageMessage],
    ["document", message.documentMessage ?? message.documentWithCaptionMessage?.message?.documentMessage],
    ["audio", message.audioMessage],
    ["video", message.videoMessage],
    ["sticker", message.stickerMessage],
  ];
  const found = candidates.find(([, content]) => content && typeof content === "object");
  if (!found) return null;

  const [kind, content] = found as [WebhookMediaKind, EvolutionMediaMessage];
  const fileName = cleanString(content.fileName) ?? cleanString(content.title);
  const caption = cleanString(content.caption);

  let label = MEDIA_LABELS[kind];
  if (kind === "audio" && content.ptt === true) label = "🎤 Mensagem de voz";
  if (kind === "document" && fileName) label = `${label}: ${fileName}`;

  return {
    media: {
      kind,
      mimeType: cleanString(content.mimetype),
      fileName,
      sizeBytes: parseFileLength(content.fileLength),
      inlineBase64: cleanString(message.base64),
    },
    caption,
    label,
  };
}

/**
 * Parseia e valida a estrutura de um payload vindo da Evolution API v2.
 */
export function parseEvolutionWebhookPayload(body: unknown): WebhookParseResult {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return { status: "malformed", error: "Estrutura de payload malformada" };
  }

  const payload = body as EvolutionPayload;

  if (
    typeof payload.event !== "string" ||
    typeof payload.instance !== "string" ||
    !payload.data ||
    typeof payload.data !== "object"
  ) {
    return { status: "malformed", error: "Estrutura de payload malformada" };
  }

  // Mudança de conexão do WhatsApp (ex.: aparelho desconectado). Só "open"/"close" interessam.
  const eventName = normalizeEventName(payload.event);
  if (eventName === "connection.update") {
    const state = typeof payload.data.state === "string" ? payload.data.state.toLowerCase() : null;
    return { status: "connection", instance: payload.instance, state: state === "open" || state === "close" ? state : null };
  }

  if (eventName === "messages.set") {
    return parseHistoryPayload(payload.instance, body as Record<string, unknown>, payload.data);
  }

  // Exclusão que a Evolution anuncia como evento próprio: o alvo é o id da mensagem apagada.
  if (eventName === "messages.delete") {
    const raw = payload.data as EvolutionPayloadData & { id?: unknown };
    const id = cleanString(raw.key?.id) ?? cleanString(raw.id);
    return id ? { status: "revoke", instance: payload.instance, externalMessageId: id } : { status: "ignored", reason: "non_text_message_ignored" };
  }

  // messages.update: na maioria são recibos de entrega/leitura (status). Quando traz uma edição/exclusão (protocolMessage,
  // editedMessage) ou status de apagada, vira edit/revoke; o resto é ignorado em silêncio.
  if (eventName === "messages.update") {
    const raw = payload.data as EvolutionPayloadData & { keyId?: unknown; messageId?: unknown; status?: unknown; remoteJid?: unknown; fromMe?: unknown };
    if (raw.message) {
      const special = parseSpecialMessage(payload.instance, { ...raw, key: raw.key ?? { remoteJid: cleanString(raw.remoteJid) ?? undefined, fromMe: Boolean(raw.fromMe) } });
      if (special) return special;
    }
    const status = typeof raw.status === "string" ? raw.status.trim().toUpperCase() : "";
    const targetId = cleanString(raw.keyId) ?? cleanString(raw.key?.id) ?? cleanString(raw.messageId);
    if (targetId && (status === "DELETED" || status === "DELETE" || status === "REVOKED")) {
      return { status: "revoke", instance: payload.instance, externalMessageId: targetId };
    }
    return { status: "ignored", reason: "status_update" };
  }

  if (eventName !== "messages.upsert" && eventName !== "messages.edited") {
    return { status: "ignored", reason: "unhandled_event" };
  }

  return parseMessageData(payload.instance, payload.data, { requireTimestamp: false });
}

const PROTOCOL_REVOKE = 0;
const PROTOCOL_MESSAGE_EDIT = 14;

function protocolKind(type: unknown): "revoke" | "edit" | null {
  if (type === PROTOCOL_REVOKE || type === "REVOKE") return "revoke";
  if (type === PROTOCOL_MESSAGE_EDIT || type === "MESSAGE_EDIT") return "edit";
  return null;
}

/** Edição, exclusão e reação chegam como mensagens "especiais" dentro do mesmo evento de mensagem. */
function parseSpecialMessage(
  instance: string,
  data: EvolutionPayloadData,
): WebhookParseResult | null {
  const layers = messageLayers(data.message);
  if (layers.length === 0) return null;

  for (const layer of layers) {
    const protocol = asObject(layer.protocolMessage) as EvolutionProtocolMessage | null;
    if (!protocol) continue;
    const kind = protocolKind(protocol.type);
    const targetId = cleanString(protocol.key?.id);
    if (kind === "revoke" && targetId) return { status: "revoke", instance, externalMessageId: targetId };
    if (kind === "edit" && targetId) {
      const newText = textFromLayers(protocol.editedMessage);
      if (!newText) return { status: "ignored", reason: "non_text_message_ignored" };
      const stamp = typeof protocol.timestampMs === "number" ? protocol.timestampMs : Number(protocol.timestampMs);
      return {
        status: "edit",
        instance,
        externalMessageId: targetId,
        newText,
        editedAt: Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString() : null,
      };
    }
    // Outros tipos de protocolo (histórico, expiração, sincronização de chave...) não são mensagens do chat.
    return { status: "ignored", reason: "non_text_message_ignored" };
  }

  for (const layer of layers) {
    const reaction = asObject(layer.reactionMessage) as { key?: EvolutionPayloadKey; text?: unknown } | null;
    if (!reaction) continue;
    const key = (data.key ?? {}) as EvolutionPayloadKey & { remoteJidAlt?: unknown; senderPn?: unknown };
    const targetId = cleanString(reaction.key?.id);
    const remoteJid = cleanString(key.remoteJid);
    if (!targetId || !remoteJid || remoteJid.endsWith("@g.us")) return { status: "ignored", reason: "non_text_message_ignored" };
    const fromMe = Boolean(key.fromMe);
    // Contato identificado por @lid: o telefone vem em chaves alternativas, quando a Evolution as manda.
    const phoneJid = remoteJid.endsWith("@lid") ? (cleanString(key.remoteJidAlt) ?? cleanString(key.senderPn) ?? remoteJid) : remoteJid;
    return {
      status: "reaction",
      instance,
      targetExternalId: targetId,
      reactorJid: fromMe ? "" : phoneJid,
      fromMe,
      // Texto vazio = a pessoa tirou a reação.
      emoji: typeof reaction.text === "string" ? reaction.text.trim() : "",
    };
  }
  return null;
}

/** O contextInfo (com stanzaId) de uma resposta: no evento, na mensagem de qualquer tipo ou numa camada embrulhada. */
function findContextInfo(message: unknown, topLevel: unknown): Loose | null {
  const candidates: Loose[] = [];
  const top = asObject(topLevel);
  if (top) candidates.push(top);
  for (const layer of messageLayers(message)) {
    const own = asObject(layer.contextInfo);
    if (own) candidates.push(own);
    for (const value of Object.values(layer)) {
      const context = asObject(asObject(value)?.contextInfo);
      if (context) candidates.push(context);
    }
  }
  return candidates.find((context) => cleanString(context.stanzaId)) ?? null;
}

const QUOTED_MEDIA_KEYS = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "ptvMessage"];

/**
 * Mensagem citada (resposta feita pelo cliente OU pelo celular): id dela no WhatsApp e um trecho do que foi citado.
 * Procura o contexto em qualquer tipo de mensagem (texto, imagem, vídeo, documento, áudio...) e também no nível do evento.
 */
export function extractQuoted(message: EvolutionMessageContent | undefined, topLevelContext?: unknown): WebhookQuoted | null {
  const context = findContextInfo(message, topLevelContext);
  const externalId = cleanString(context?.stanzaId);
  if (!context || !externalId) return null;
  const quotedMessage = context.quotedMessage;
  const text = textFromLayers(quotedMessage);
  const hasMedia = messageLayers(quotedMessage).some((layer) => QUOTED_MEDIA_KEYS.some((name) => name in layer));
  return { externalId, text: text ? text.slice(0, 200) : null, hasMedia };
}

/** Interpreta uma mensagem no formato da Evolution (ao vivo ou item do histórico). */
function parseMessageData(
  instance: string,
  data: EvolutionPayloadData,
  options: { requireTimestamp: boolean },
): WebhookParseResult {
  const key = data.key ?? {};
  const remoteJid = key.remoteJid;

  if (
    !remoteJid ||
    typeof remoteJid !== "string" ||
    !remoteJid.includes("@")
  ) {
    return { status: "malformed", error: "Identificador remoto inválido" };
  }

  // Lista de transmissão, canal e Status nunca são conversa: o identificador de uma lista poderia passar por telefone.
  if (/@(broadcast|newsletter)$/.test(remoteJid)) {
    return { status: "ignored", reason: "broadcast_or_channel" };
  }

  // Edição, exclusão e reação não são mensagens novas (o histórico não as carrega).
  if (!options.requireTimestamp) {
    const special = parseSpecialMessage(instance, data);
    if (special) return special;
  }

  const conversationType = remoteJid.endsWith("@g.us") ? "group" : "individual";
  const senderJid = typeof key.participant === "string" ? key.participant : null;
  if (conversationType === "group" && !Boolean(key.fromMe) && !senderJid) {
    return { status: "ignored", reason: "group_sender_missing" };
  }

  const rawText =
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text ??
    messageLayers(data.message).map((layer) => cleanString(layer.conversation) ?? cleanString(asObject(layer.extendedTextMessage)?.text)).find(Boolean) ??
    null;

  const hasText = typeof rawText === "string" && rawText.trim() !== "";
  const extracted = hasText
    ? null
    : (messageLayers(data.message).map((layer) => extractWebhookMedia(layer as EvolutionMessageContent)).find(Boolean) ?? null);

  // Mensagens que não são texto nem mídia reconhecida (reações, enquetes, etc.) seguem ignoradas.
  if (!hasText && !extracted) {
    return { status: "ignored", reason: "non_text_message_ignored" };
  }
  const textContent = extracted ? (extracted.caption ?? extracted.label) : (rawText as string);

  const fromMe = Boolean(key.fromMe);
  const externalMessageId = key.id ?? null;
  const pushName =
    typeof data.pushName === "string" && data.pushName.trim() !== ""
      ? data.pushName.trim()
      : null;

  let occurredAt: string;
  const tsRaw = data.messageTimestamp;
  if (typeof tsRaw === "number" && !isNaN(tsRaw)) {
    const ms = tsRaw > 1e11 ? tsRaw : tsRaw * 1000;
    occurredAt = new Date(ms).toISOString();
  } else if (typeof tsRaw === "string" && !isNaN(Number(tsRaw))) {
    const tsNum = Number(tsRaw);
    const ms = tsNum > 1e11 ? tsNum : tsNum * 1000;
    occurredAt = new Date(ms).toISOString();
  } else if (options.requireTimestamp) {
    return { status: "ignored", reason: "missing_timestamp" };
  } else {
    occurredAt = new Date().toISOString();
  }

  return {
    status: "valid",
    instance,
    remoteJid,
    conversationType,
    senderJid,
    groupSubject:
      typeof data.subject === "string" && data.subject.trim() !== ""
        ? data.subject.trim()
        : null,
    fromMe,
    externalMessageId,
    pushName,
    textContent,
    media: extracted ? { ...extracted.media, inlineBase64: extracted.media.inlineBase64 ?? cleanString(data.base64) } : null,
    occurredAt,
    quoted: options.requireTimestamp ? null : extractQuoted(data.message, (data as { contextInfo?: unknown }).contextInfo),
  };
}

/**
 * Lote de histórico (evento messages.set da Evolution): `data` é a lista de mensagens e
 * isLatest/progress vêm no nível do corpo. Só as mensagens dos últimos 15 dias entram.
 */
function parseHistoryPayload(
  instance: string,
  body: Record<string, unknown>,
  data: unknown,
  now: Date = new Date(),
): WebhookParseResult {
  if (!Array.isArray(data)) {
    return { status: "malformed", error: "Lote de histórico malformado" };
  }

  const cutoff = now.getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const items: HistoryMessageItem[] = [];
  let skipped = 0;

  for (const entry of data) {
    if (!entry || typeof entry !== "object") {
      skipped += 1;
      continue;
    }
    const remoteJid = (entry as EvolutionPayloadData).key?.remoteJid;
    if (typeof remoteJid !== "string" || /^status@broadcast$|@broadcast$|@newsletter$/.test(remoteJid)) {
      skipped += 1;
      continue;
    }
    const parsed = parseMessageData(instance, entry as EvolutionPayloadData, { requireTimestamp: true });
    if (parsed.status !== "valid" || !parsed.externalMessageId) {
      skipped += 1;
      continue;
    }
    const occurred = new Date(parsed.occurredAt).getTime();
    if (Number.isNaN(occurred) || occurred < cutoff || occurred > now.getTime() + 5 * 60 * 1000) {
      skipped += 1;
      continue;
    }
    items.push({
      external_message_id: parsed.externalMessageId,
      remote_jid: parsed.remoteJid,
      sender_jid: parsed.senderJid,
      from_me: parsed.fromMe,
      push_name: parsed.fromMe ? null : parsed.pushName,
      text_content: parsed.textContent,
      occurred_at: parsed.occurredAt,
    });
  }

  const progress = typeof body.progress === "number" && Number.isFinite(body.progress) ? body.progress : null;
  return {
    status: "history",
    instance,
    items,
    received: data.length,
    skipped,
    isLatest: body.isLatest === true,
    progress,
  };
}
