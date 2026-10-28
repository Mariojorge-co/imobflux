// Rascunho da caixa de mensagem por conversa. Fica em memória (sobrevive à troca de conversa e ao Esc, que fecha a conversa)
// e é espelhado no sessionStorage (sobrevive a recarregar a página). Nunca vai para o servidor nem para log.
// O rascunho também lembra a mensagem que está sendo respondida (citação) e avisa a lista de conversas quando muda.

import type { ReplyRef } from "@/lib/conversations/message-merge";

const KEY_PREFIX = "imobflux:draft:";
const REPLY_KEY_PREFIX = "imobflux:draft-reply:";
const memory = new Map<string, string>();
const replyMemory = new Map<string, ReplyDraft>();
const listeners = new Set<() => void>();

export type ReplyDraft = ReplyRef & { author: string };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

/** A lista de conversas assina para mostrar "Rascunho:" (avisa a cada mudança; quem assina decide o atraso). */
export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDraft(conversationId: string): string {
  const inMemory = memory.get(conversationId);
  if (inMemory !== undefined) return inMemory;
  try {
    return storage()?.getItem(KEY_PREFIX + conversationId) ?? "";
  } catch {
    return "";
  }
}

export function setDraft(conversationId: string, text: string): void {
  if (text === "") {
    clearDraft(conversationId);
    return;
  }
  if (memory.get(conversationId) === text) return;
  memory.set(conversationId, text);
  try {
    storage()?.setItem(KEY_PREFIX + conversationId, text);
  } catch {
    // sem armazenamento (modo privado): a cópia em memória basta
  }
  notify();
}

export function clearDraft(conversationId: string): void {
  const had = memory.has(conversationId) || getDraft(conversationId) !== "";
  memory.delete(conversationId);
  try {
    storage()?.removeItem(KEY_PREFIX + conversationId);
  } catch {
    // ignora
  }
  if (had) notify();
}

export function getReplyDraft(conversationId: string): ReplyDraft | null {
  const inMemory = replyMemory.get(conversationId);
  if (inMemory) return inMemory;
  try {
    const raw = storage()?.getItem(REPLY_KEY_PREFIX + conversationId);
    return raw ? (JSON.parse(raw) as ReplyDraft) : null;
  } catch {
    return null;
  }
}

/** Guarda (ou limpa, com null) a citação em andamento daquela conversa. */
export function setReplyDraft(conversationId: string, reply: ReplyDraft | null): void {
  if (!reply) {
    const had = replyMemory.has(conversationId) || getReplyDraft(conversationId) !== null;
    replyMemory.delete(conversationId);
    try {
      storage()?.removeItem(REPLY_KEY_PREFIX + conversationId);
    } catch {
      // ignora
    }
    if (had) notify();
    return;
  }
  replyMemory.set(conversationId, reply);
  try {
    storage()?.setItem(REPLY_KEY_PREFIX + conversationId, JSON.stringify(reply));
  } catch {
    // sem armazenamento: a cópia em memória basta
  }
  notify();
}

const PREVIEW_LIMIT = 60;

/**
 * Texto que a lista de conversas mostra depois de "Rascunho:". Vazio = não há rascunho.
 * O texto digitado vem primeiro; só com a citação (sem texto) mostra a quem a resposta se dirige.
 */
export function draftPreview(text: string | null | undefined, replyAuthor?: string | null): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean) return clean.length > PREVIEW_LIMIT ? `${clean.slice(0, PREVIEW_LIMIT - 1)}…` : clean;
  if (replyAuthor) return `respondendo a ${replyAuthor}`;
  return "";
}

export function getDraftPreview(conversationId: string): string {
  return draftPreview(getDraft(conversationId), getReplyDraft(conversationId)?.author);
}
