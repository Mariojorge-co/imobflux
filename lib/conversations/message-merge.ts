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
    if (!text || message.has_attachments) return true;
    const at = new Date(message.occurred_at).getTime();
    return !crm.some((own) => normalizedText(own) === text && Math.abs(new Date(own.occurred_at).getTime() - at) <= ECHO_WINDOW_MS);
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
  const queuedReal = all.filter((message) => !isPendingMessage(message) && message.direction === "outgoing" && message.origin === "crm" && message.status === "queued");
  const used = new Set<string>();
  const withoutDuplicatedPending = all.filter((message) => {
    if (!isPendingMessage(message)) return true;
    const text = normalizedText(message);
    const at = new Date(message.occurred_at).getTime();
    const match = queuedReal.find((own) => !used.has(own.id) && normalizedText(own) === text && Math.abs(new Date(own.occurred_at).getTime() - at) <= ECHO_WINDOW_MS);
    if (!match) return true;
    used.add(match.id);
    return false;
  });

  return collapseEchoDuplicates(withoutDuplicatedPending);
}

/** Tira uma mensagem provisória (enviada com sucesso, falhou ou cancelada). */
export function removePendingMessage(messages: ConversationMessage[], pendingId: string): ConversationMessage[] {
  return messages.filter((message) => message.id !== pendingId);
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
