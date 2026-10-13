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
  | { status: "ignored"; reason: "unhandled_event" | "group_sender_missing" | "non_text_message_ignored" | "missing_timestamp" | "broadcast_or_channel" }
  | { status: "connection"; instance: string; state: "open" | "close" | null }
  | WebhookHistoryResult
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
};

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: {
    text?: string;
  };
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
  if (payload.event === "connection.update") {
    const state = typeof payload.data.state === "string" ? payload.data.state.toLowerCase() : null;
    return { status: "connection", instance: payload.instance, state: state === "open" || state === "close" ? state : null };
  }

  if (payload.event === "messages.set") {
    return parseHistoryPayload(payload.instance, body as Record<string, unknown>, payload.data);
  }

  if (payload.event !== "messages.upsert") {
    return { status: "ignored", reason: "unhandled_event" };
  }

  return parseMessageData(payload.instance, payload.data, { requireTimestamp: false });
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

  const conversationType = remoteJid.endsWith("@g.us") ? "group" : "individual";
  const senderJid = typeof key.participant === "string" ? key.participant : null;
  if (conversationType === "group" && !Boolean(key.fromMe) && !senderJid) {
    return { status: "ignored", reason: "group_sender_missing" };
  }

  const rawText =
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text ??
    null;

  const hasText = typeof rawText === "string" && rawText.trim() !== "";
  const extracted = hasText ? null : extractWebhookMedia(data.message);

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
