import type { ConversationMessage } from "@/lib/conversations/data";

/** Prefixo dos ids provisórios das mensagens que ainda estão sendo enviadas (bolha otimista). */
export const PENDING_MESSAGE_PREFIX = "pending-";

export const isPendingMessage = (message: Pick<ConversationMessage, "id">) => message.id.startsWith(PENDING_MESSAGE_PREFIX);

/** Janela em que um "eco" do WhatsApp é considerado a mesma mensagem enviada pelo CRM. */
export const ECHO_WINDOW_MS = 90_000;

const byTime = (left: ConversationMessage, right: ConversationMessage) =>
  left.occurred_at.localeCompare(right.occurred_at) || left.id.localeCompare(right.id);

const normalizedText = (message: ConversationMessage) => (message.text_content ?? "").replace(/\s+/g, " ").trim();

/**
 * Mensagem enviada pelo ImobFlux volta pelo webhook como "enviada por mim" (eco, origem WhatsApp). Normalmente o
 * banco reconhece o eco pelo identificador externo, mas se o eco chegar antes da confirmação do envio, sobram duas
 * linhas iguais. Na tela, o eco é escondido quando existe a mensagem do CRM com o mesmo texto no mesmo instante.
 * Só mensagens de saída, só texto igual e só dentro de ECHO_WINDOW_MS; nada é apagado do banco.
 */
export function collapseEchoDuplicates(messages: ConversationMessage[]): ConversationMessage[] {
  const crm = messages.filter((message) => message.direction === "outgoing" && message.origin === "crm" && !message.is_history && message.status !== "failed");
  if (crm.length === 0) return messages;

  return messages.filter((message) => {
    if (message.direction !== "outgoing" || message.origin !== "whatsapp" || message.is_history) return true;
    const text = normalizedText(message);
    if (!text) return true;
    const at = new Date(message.occurred_at).getTime();
    // Arquivo: o eco só some se a nossa também tem arquivo (o rótulo do arquivo é o mesmo nos dois lados).
    return !crm.some(
      (own) =>
        normalizedText(own) === text &&
        Boolean(own.has_attachments) === Boolean(message.has_attachments) &&
        Math.abs(new Date(own.occurred_at).getTime() - at) <= ECHO_WINDOW_MS,
    );
  });
}

/**
 * Junta mensagens novas às que já estão na tela: por id (a versão nova substitui a antiga), ordenadas por hora, sem eco
 * duplicado. Enquanto o envio está em andamento, a versão "na fila" que o servidor já gravou (mesma mensagem) substitui a
 * bolha provisória correspondente, uma para uma, para não aparecerem duas bolhas "enviando…".
 */
export function mergeMessages(previous: ConversationMessage[], incoming: ConversationMessage[]): ConversationMessage[] {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);

  const all = [...byId.values()].sort(byTime);
  // A provisória ("enviando…" ou "não enviada") é substituída, uma para uma, pela versão que o servidor já gravou
  // ("na fila" ou "falhou"): assim nunca aparecem duas bolhas da mesma mensagem. O motivo da falha, que só a
  // provisória conhecia, passa para a versão gravada.
  const stored = all.filter((message) => !isPendingMessage(message) && message.direction === "outgoing" && message.origin === "crm" && (message.status === "queued" || message.status === "failed"));
  const used = new Set<string>();
  const reasons = new Map<string, string>();
  const withoutDuplicatedPending = all.filter((message) => {
    if (!isPendingMessage(message)) return true;
    const text = normalizedText(message);
    const at = new Date(message.occurred_at).getTime();
    const match = stored.find(
      (own) =>
        !used.has(own.id) &&
        (message.status === "failed" ? own.status === "failed" : own.status === "queued") &&
        normalizedText(own) === text &&
        Math.abs(new Date(own.occurred_at).getTime() - at) <= ECHO_WINDOW_MS,
    );
    if (!match) return true;
    used.add(match.id);
    if (message.send_error) reasons.set(match.id, message.send_error);
    return false;
  });
  const withReasons = withoutDuplicatedPending.map((message) => (reasons.has(message.id) ? { ...message, send_error: reasons.get(message.id) } : message));

  return collapseEchoDuplicates(withReasons);
}

/** Tira uma mensagem provisória (enviada com sucesso, falhou ou cancelada). */
export function removePendingMessage(messages: ConversationMessage[], pendingId: string): ConversationMessage[] {
  return messages.filter((message) => message.id !== pendingId);
}

/** Mensagem provisória de um ARQUIVO sendo enviado: mostra o nome, o tamanho e (imagem) a miniatura local. */
export function buildPendingMediaMessage(input: {
  idempotencyKey: string;
  /** Legenda ou rótulo do arquivo: o MESMO texto que o servidor grava (assim a bolha provisória é substituída uma a uma). */
  text: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string | null;
  now?: Date;
}): ConversationMessage {
  const base = buildPendingMessage({ idempotencyKey: input.idempotencyKey, text: input.text, now: input.now });
  return {
    ...base,
    has_attachments: true,
    attachments: [
      {
        id: `local-${input.idempotencyKey}`,
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        status: "available",
        local_preview_url: input.previewUrl ?? null,
      },
    ],
  };
}

/** Marca uma provisória como "não enviada", guardando o motivo para mostrar na bolha. */
export function failPendingMessage(messages: ConversationMessage[], pendingId: string, reason: string): ConversationMessage[] {
  return messages.map((message) => (message.id === pendingId ? { ...message, status: "failed", send_error: reason } : message));
}

/** Mensagem provisória exibida como "enviando…" assim que o usuário clica em enviar. */
export function buildPendingMessage(input: { idempotencyKey: string; text: string; now?: Date }): ConversationMessage {
  return {
    id: `${PENDING_MESSAGE_PREFIX}${input.idempotencyKey}`,
    direction: "outgoing",
    origin: "crm",
    status: "sending",
    text_content: input.text,
    occurred_at: (input.now ?? new Date()).toISOString(),
    has_attachments: false,
    is_history: false,
    attachments: [],
    internal_author_name: null,
    sender_display_name: null,
  };
}

/** Texto curto do estado de uma mensagem enviada (vazio quando está tudo certo). */
export function outgoingStatusLabel(message: Pick<ConversationMessage, "direction" | "status">): "sending" | "failed" | null {
  if (message.direction !== "outgoing") return null;
  if (message.status === "sending" || message.status === "queued") return "sending";
  if (message.status === "failed") return "failed";
  return null;
}

/** Uma falha que a pessoa já refez ("tentar de novo"): fica escondida mesmo que a versão gravada chegue depois. */
export type DismissedFailure = { id: string; text: string; at: string };

export function isDismissedFailure(message: ConversationMessage, dismissed: ReadonlyArray<DismissedFailure>): boolean {
  if (dismissed.length === 0 || message.direction !== "outgoing" || message.origin !== "crm") return false;
  if (dismissed.some((item) => item.id === message.id)) return true;
  if (message.status !== "failed") return false;
  const text = normalizedText(message);
  const at = new Date(message.occurred_at).getTime();
  return dismissed.some((item) => item.text.replace(/s+/g, " ").trim() === text && Math.abs(new Date(item.at).getTime() - at) <= ECHO_WINDOW_MS);
}
