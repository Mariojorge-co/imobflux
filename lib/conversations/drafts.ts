// Rascunho da caixa de mensagem por conversa. Fica em memória (sobrevive à troca de conversa e ao Esc, que fecha a conversa)
// e é espelhado no sessionStorage (sobrevive a recarregar a página). Nunca vai para o servidor nem para log.

const KEY_PREFIX = "imobflux:draft:";
const memory = new Map<string, string>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
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
  memory.set(conversationId, text);
  try {
    storage()?.setItem(KEY_PREFIX + conversationId, text);
  } catch {
    // sem armazenamento (modo privado): a cópia em memória basta
  }
}

export function clearDraft(conversationId: string): void {
  memory.delete(conversationId);
  try {
    storage()?.removeItem(KEY_PREFIX + conversationId);
  } catch {
    // ignora
  }
}
