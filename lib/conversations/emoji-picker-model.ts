// Regras puras do seletor de emoji da caixa de mensagem (testáveis sem navegador): busca e recentes por pessoa.
// A inserção no cursor é a mesma das respostas rápidas (lib/quick-replies/insert).

import { EMOJI_CATEGORIES, EMOJI_MAX_RECENTS } from "@/lib/conversations/emoji-data";

export type EmojiEntry = { emoji: string; keywords: string };

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function parseEntry(raw: string): EmojiEntry {
  const separator = raw.indexOf("|");
  return { emoji: raw.slice(0, separator), keywords: raw.slice(separator + 1) };
}

export const ALL_EMOJIS: ReadonlyArray<EmojiEntry> = EMOJI_CATEGORIES.flatMap((category) => category.items.map(parseEntry));

/** Emojis cujas palavras contêm TODAS as palavras buscadas (sem acento, sem maiúsculas). Busca vazia = nada. */
export function searchEmojis(query: string): EmojiEntry[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return ALL_EMOJIS.filter((entry) => terms.every((term) => entry.keywords.includes(term)));
}

export function emojiRecentsKey(memberId: string): string {
  return `imobflux:emoji-recentes:${memberId}`;
}

/** Lê a lista guardada; qualquer valor estranho vira lista vazia. */
export function parseEmojiRecents(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 16).slice(0, EMOJI_MAX_RECENTS);
  } catch {
    return [];
  }
}

/** O emoji escolhido vai para o começo; sem repetir e limitado a EMOJI_MAX_RECENTS. */
export function pushEmojiRecent(recents: ReadonlyArray<string>, emoji: string): string[] {
  return [emoji, ...recents.filter((item) => item !== emoji)].slice(0, EMOJI_MAX_RECENTS);
}
