export type WebhookParseResult =
  | { status: "invalid_secret"; error: string }
  | { status: "malformed"; error: string }
  | { status: "ignored"; reason: "unhandled_event" | "group_event_ignored" | "non_text_message_ignored" }
  | {
      status: "valid";
      instance: string;
      remoteJid: string;
      fromMe: boolean;
      externalMessageId: string | null;
      pushName: string | null;
      textContent: string;
      occurredAt: string;
    };

interface EvolutionPayloadKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
}

interface EvolutionPayloadData {
  key?: EvolutionPayloadKey;
  pushName?: string;
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
    };
  };
  messageTimestamp?: number | string;
}

interface EvolutionPayload {
  event?: string;
  instance?: string;
  data?: EvolutionPayloadData;
}

/**
 * Valida o secret do webhook enviado no header X-Evolution-Secret.
 */
export function validateWebhookSecret(
  incomingSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) {
    return true; // Se não configurado no servidor, não bloqueia por secret
  }
  return incomingSecret === expectedSecret;
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
    remoteJid.endsWith("@g.us") ||
    remoteJid.includes("@g.us") ||
    !remoteJid.includes("@")
  ) {
    return { status: "ignored", reason: "group_event_ignored" };
  }

  const rawText =
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text ??
    null;

  if (typeof rawText !== "string" || rawText.trim() === "") {
    return { status: "ignored", reason: "non_text_message_ignored" };
  }

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
    fromMe,
    externalMessageId,
    pushName,
    textContent: rawText,
    occurredAt,
  };
}
