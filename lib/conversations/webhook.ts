import { createHash, timingSafeEqual } from "node:crypto";

export type WebhookMediaKind = "image" | "document" | "audio" | "video" | "sticker";

/** Metadados de uma mensagem de mídia (o binário ainda não é baixado). */
export type WebhookMedia = {
  kind: WebhookMediaKind;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
};

export type WebhookParseResult =
  | { status: "invalid_secret"; error: string }
  | { status: "malformed"; error: string }
  | { status: "ignored"; reason: "unhandled_event" | "group_sender_missing" | "non_text_message_ignored" }
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
}

interface EvolutionPayloadData {
  key?: EvolutionPayloadKey;
  pushName?: string;
  subject?: string;
  message?: EvolutionMessageContent;
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

  if (payload.event !== "messages.upsert") {
    return { status: "ignored", reason: "unhandled_event" };
  }

  const data = payload.data;
  const key = data.key ?? {};
  const remoteJid = key.remoteJid;

  if (
    !remoteJid ||
    typeof remoteJid !== "string" ||
    !remoteJid.includes("@")
  ) {
    return { status: "malformed", error: "Identificador remoto inválido" };
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
  } else {
    occurredAt = new Date().toISOString();
  }

  return {
    status: "valid",
    instance: payload.instance,
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
    media: extracted?.media ?? null,
    occurredAt,
  };
}
