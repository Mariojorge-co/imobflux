import type { ConversationMessage, MessageReaction, ReplySnapshot } from "@/lib/conversations/data";
import { isPendingMessage } from "@/lib/conversations/message-merge";

// Regras de tela do pacote de mensagens. Funções puras: o banco continua sendo a decisão final (cada ação é revalidada lá);
// aqui só se decide o que MOSTRAR, para a pessoa não ver botões que o banco vai recusar.

/** Janela para editar uma mensagem enviada (igual à do banco). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** Janela para apagar para todos (igual à do banco). */
export const REVOKE_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Quantas conversas, no máximo, recebem uma mesma mensagem encaminhada de uma vez. */
export const FORWARD_MAX_TARGETS = 5;
/** Fixadas por pessoa (igual ao banco). */
export const PIN_LIMIT = 5;

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export const MORE_EMOJIS = [
  "😀", "😃", "😄", "😁", "😅", "🤣", "🙂", "😉", "😊", "😍", "🥰", "😘",
  "😎", "🤔", "🙄", "😬", "😴", "😭", "😡", "🤯", "😱", "🥳", "🤝", "👏",
  "🙌", "👌", "✌️", "🤞", "💪", "👀", "🔥", "✨", "🎉", "💯", "✅", "❌",
  "⭐", "🏠", "🔑", "📍", "📞", "💰", "📅", "⏰", "💙", "💚", "🧡", "💔",
] as const;

export type Viewer = { memberId: string; role: "owner" | "attendant" };

export type MessageCapabilities = {
  canReply: boolean;
  canEdit: boolean;
  canDeleteForEveryone: boolean;
  /** "Apagar para mim": esconde no ImobFlux para a equipe toda (o WhatsApp não é tocado). */
  canHide: boolean;
  canForward: boolean;
  canReact: boolean;
  canCopy: boolean;
  /** Só o dono: ver o texto anterior de uma mensagem editada e o original de uma apagada para todos. */
  canViewHistory: boolean;
};

const NONE: MessageCapabilities = {
  canReply: false,
  canEdit: false,
  canDeleteForEveryone: false,
  canHide: false,
  canForward: false,
  canReact: false,
  canCopy: false,
  canViewHistory: false,
};

const DELIVERED = new Set(["sent", "delivered", "read"]);

/**
 * O que a pessoa pode fazer com a mensagem, na tela. Mensagem provisória, na fila ou que falhou só pode ser copiada;
 * mensagem apagada não tem ação nenhuma. O banco repete todas as regras de editar / apagar.
 */
export function messageCapabilities(
  message: ConversationMessage,
  viewer: Viewer | null,
  options: { isGroup?: boolean; now?: number } = {},
): MessageCapabilities {
  if (message.internal_note) return NONE;
  if (message.deleted_at) return { ...NONE, canViewHistory: viewer?.role === "owner" };
  const text = Boolean(message.text_content?.trim());
  if (isPendingMessage(message) || message.status === "failed" || message.status === "queued" || message.status === "sending") {
    return { ...NONE, canCopy: text };
  }


  const now = options.now ?? Date.now();
  const age = now - new Date(message.occurred_at).getTime();
  const outgoingFromCrm = message.direction === "outgoing" && message.origin === "crm" && !message.is_history;
  const mine = Boolean(viewer && message.internal_author_member_id && message.internal_author_member_id === viewer.memberId);
  const mayChange = Boolean(viewer && (viewer.role === "owner" || mine));
  const hasExternalId = message.has_external_id !== false;
  const delivered = DELIVERED.has(message.status);
  const hasFiles = Boolean(message.has_attachments || message.attachments?.length);

  return {
    canReply: Boolean(viewer),
    canEdit: outgoingFromCrm && mayChange && hasExternalId && delivered && !hasFiles && text && age <= EDIT_WINDOW_MS,
    canDeleteForEveryone: outgoingFromCrm && mayChange && hasExternalId && delivered && age <= REVOKE_WINDOW_MS,
    canHide: Boolean(viewer),
    canForward: Boolean(viewer) && (text || hasFiles),
    canReact: Boolean(viewer) && hasExternalId && !options.isGroup,
    canCopy: text,
    canViewHistory: viewer?.role === "owner" && Boolean(message.edited_at),
  };
}

/** Quanto falta (em ms) para a mensagem deixar de poder ser editada; 0 se já passou. */
export function editTimeLeftMs(message: Pick<ConversationMessage, "occurred_at">, now: number = Date.now()): number {
  return Math.max(0, EDIT_WINDOW_MS - (now - new Date(message.occurred_at).getTime()));
}

export type ReactionGroup = { emoji: string; count: number; mine: boolean; names: string[] };

/** Junta as reações iguais ("👍 3"), mantendo a ordem de chegada do primeiro de cada emoji. */
export function groupReactions(reactions: ReadonlyArray<MessageReaction> | undefined): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions ?? []) {
    const group = groups.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false, names: [] };
    group.count += 1;
    group.mine = group.mine || reaction.mine;
    if (reaction.name) group.names.push(reaction.name);
    groups.set(reaction.emoji, group);
  }
  return [...groups.values()];
}

/** Texto curto da citação (cartão acima da caixa e dentro da bolha). */
export function replyPreviewText(snapshot: ReplySnapshot | null | undefined): string {
  if (!snapshot) return "Mensagem";
  if (snapshot.deleted) return "🚫 Mensagem apagada";
  const text = snapshot.text?.trim();
  if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  return snapshot.has_media ? "📎 Arquivo" : "Mensagem";
}

/**
 * Nome mostrado no cartão de citação. Mensagem da NOSSA conta sem membro identificado (enviada pelo celular) ficava como
 * "Equipe"; para o dono isso é "Você" (o número é o dele); para os demais, "Equipe (celular)".
 */
export function quoteAuthorLabel(snapshot: ReplySnapshot | null | undefined, viewer: Viewer | null | undefined): string {
  const author = snapshot?.author?.trim();
  if (snapshot?.direction === "outgoing" && (!author || author === "Equipe")) {
    return viewer?.role === "owner" ? "Você" : "Equipe (celular)";
  }
  return author || "Contato";
}

/** Monta o resumo da mensagem que está sendo respondida a partir da mensagem da tela. */
export function snapshotFromMessage(message: ConversationMessage, contactName?: string | null): ReplySnapshot {
  const outgoing = message.direction === "outgoing";
  return {
    author: outgoing ? (message.internal_author_name ?? "Equipe") : (message.sender_display_name ?? contactName ?? "Contato"),
    direction: message.direction,
    text: message.deleted_at ? null : (message.text_content ?? null),
    deleted: Boolean(message.deleted_at),
    has_media: Boolean(message.has_attachments || message.attachments?.length),
  };
}

export type CaptionKeyAction = "send" | "newline" | "none";

/**
 * Teclas na legenda de um arquivo (e na caixa de mensagem): Enter envia, Shift+Enter quebra a linha. Enquanto um método de
 * digitação (acentos, IME) está compondo, Enter confirma a composição e NÃO envia.
 */
export function captionKeyAction(event: { key: string; shiftKey: boolean; isComposing?: boolean }): CaptionKeyAction {
  if (event.key !== "Enter" || event.isComposing) return "none";
  return event.shiftKey ? "newline" : "send";
}

/** Destacar o termo buscado dentro de um texto: devolve pedaços, marcando os que casam (sem diferenciar maiúsculas). */
export function splitForHighlight(text: string, term: string): Array<{ text: string; match: boolean }> {
  const needle = term.trim();
  if (needle.length < 2 || !text) return [{ text, match: false }];
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerNeedle, cursor);
    if (index < 0) break;
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}

/** Lê a mensagem copiada: o texto simples (sem rótulo de arquivo quando só há o rótulo). */
export function copyableText(message: Pick<ConversationMessage, "text_content" | "deleted_at">): string {
  return message.deleted_at ? "" : (message.text_content ?? "");
}
