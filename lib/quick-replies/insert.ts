// Inserção de texto na caixa de mensagem e gatilho "/" — funções puras (sem DOM), testáveis.

export type InsertResult = { value: string; caret: number };

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(index, length));
}

/**
 * Insere o texto na posição do cursor (substituindo a seleção, se houver). Sem seleção conhecida, vai para o fim.
 * Devolve null se o resultado passaria do limite (quem chama avisa a pessoa; nada é cortado em silêncio).
 */
export function insertAtCursor(
  value: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
  snippet: string,
  maxLength: number,
): InsertResult | null {
  const start = clampIndex(selectionStart ?? value.length, value.length);
  const end = clampIndex(selectionEnd ?? start, value.length);
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const next = value.slice(0, from) + snippet + value.slice(to);
  if (next.length > maxLength) return null;
  return { value: next, caret: from + snippet.length };
}

export type SlashTrigger = { start: number; end: number; query: string };

const SLASH_QUERY_MAX = 30;

/**
 * "/" no início da caixa, ou depois de espaço/quebra de linha, abre a lista. Só vale enquanto o que vem depois do "/"
 * até o cursor não tem espaço. "1/2", "e/ou" e endereços não acionam (a barra vem colada em outro caractere).
 */
export function detectSlashTrigger(value: string, caret: number): SlashTrigger | null {
  const end = clampIndex(caret, value.length);
  let index = end - 1;
  while (index >= 0) {
    const char = value[index];
    if (char === "/") break;
    if (/\s/.test(char)) return null;
    index -= 1;
  }
  if (index < 0) return null;
  if (index > 0 && !/\s/.test(value[index - 1])) return null;
  const query = value.slice(index + 1, end);
  if (query.length > SLASH_QUERY_MAX || query.includes("/")) return null;
  return { start: index, end, query };
}

/** Troca "/termo" pelo texto da resposta, deixando o cursor no fim do trecho inserido. */
export function replaceSlashTrigger(
  value: string,
  trigger: SlashTrigger,
  snippet: string,
  maxLength: number,
): InsertResult | null {
  const next = value.slice(0, trigger.start) + snippet + value.slice(trigger.end);
  if (next.length > maxLength) return null;
  return { value: next, caret: trigger.start + snippet.length };
}
