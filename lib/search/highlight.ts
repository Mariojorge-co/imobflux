// Destaque do termo buscado dentro de um trecho. Devolve pedaços de texto (nunca HTML): quem desenha usa elementos do React,
// então o conteúdo da mensagem nunca é interpretado como marcação.

export type HighlightPart = { text: string; match: boolean };

export function splitHighlight(text: string, term: string): HighlightPart[] {
  const needle = term.trim();
  if (!text) return [];
  if (needle.length < 1) return [{ text, match: false }];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const found = lowerText.indexOf(lowerNeedle, cursor);
    if (found === -1) break;
    if (found > cursor) parts.push({ text: text.slice(cursor, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    cursor = found + needle.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}

export const GLOBAL_SEARCH_MIN = 2;
export const GLOBAL_SEARCH_PAGE = 20;

/** Endereço para abrir o resultado: a mensagem achada (rola até ela) ou só a conversa. */
export function searchResultHref(conversationId: string, messageId: string | null | undefined): string {
  return messageId ? `/conversas/${conversationId}?msg=${encodeURIComponent(messageId)}` : `/conversas/${conversationId}`;
}
