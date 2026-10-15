import type { QuickReply, QuickReplyCategory } from "@/lib/quick-replies/types";

export type QuickReplyChip = "all" | "top" | "none" | { categoryId: string };

export const TOP_REPLIES_LIMIT = 10;
export const SLASH_RESULTS_LIMIT = 8;

/** Minúsculas e sem acento, para a busca achar "visita" em "Visíta". */
export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

function matches(reply: QuickReply, query: string): boolean {
  if (!query) return true;
  return normalizeSearch(reply.title).includes(query) || normalizeSearch(reply.body).includes(query);
}

function byTitle(a: QuickReply, b: QuickReply): number {
  return a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" });
}

function byUsage(a: QuickReply, b: QuickReply): number {
  if (b.use_count !== a.use_count) return b.use_count - a.use_count;
  const aTime = a.last_used_at ? Date.parse(a.last_used_at) : 0;
  const bTime = b.last_used_at ? Date.parse(b.last_used_at) : 0;
  if (bTime !== aTime) return bTime - aTime;
  return byTitle(a, b);
}

/** Respostas ativas que passam na busca e no filtro, já ordenadas ("Mais usadas" por uso; o resto por título). */
export function filterReplies(replies: QuickReply[], query: string, chip: QuickReplyChip): QuickReply[] {
  const normalized = normalizeSearch(query);
  let list = replies.filter((reply) => reply.is_active && matches(reply, normalized));
  if (chip === "none") list = list.filter((reply) => reply.category_id === null);
  else if (typeof chip === "object") list = list.filter((reply) => reply.category_id === chip.categoryId);
  else if (chip === "top") {
    return list.filter((reply) => reply.use_count > 0).sort(byUsage).slice(0, TOP_REPLIES_LIMIT);
  }
  return list.sort(byTitle);
}

export type QuickReplyGroup = { category: QuickReplyCategory | null; replies: QuickReply[] };

/** Agrupa por categoria (ordem alfabética), com "Sem categoria" por último; grupos vazios não aparecem. */
export function groupByCategory(replies: QuickReply[], categories: QuickReplyCategory[]): QuickReplyGroup[] {
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  const groups: QuickReplyGroup[] = [];
  for (const category of sorted) {
    const inCategory = replies.filter((reply) => reply.category_id === category.id);
    if (inCategory.length > 0) groups.push({ category, replies: inCategory });
  }
  const loose = replies.filter(
    (reply) => reply.category_id === null || !categories.some((category) => category.id === reply.category_id),
  );
  if (loose.length > 0) groups.push({ category: null, replies: loose });
  return groups;
}

/** Lista curta do atalho "/": título que começa com o termo vem primeiro; sem termo, as mais usadas. */
export function searchForSlash(replies: QuickReply[], query: string): QuickReply[] {
  const normalized = normalizeSearch(query);
  const active = replies.filter((reply) => reply.is_active);
  if (!normalized) return [...active].sort(byUsage).slice(0, SLASH_RESULTS_LIMIT);
  const starts: QuickReply[] = [];
  const contains: QuickReply[] = [];
  const inBody: QuickReply[] = [];
  for (const reply of active) {
    const title = normalizeSearch(reply.title);
    if (title.startsWith(normalized)) starts.push(reply);
    else if (title.includes(normalized)) contains.push(reply);
    else if (normalizeSearch(reply.body).includes(normalized)) inBody.push(reply);
  }
  return [...starts.sort(byUsage), ...contains.sort(byUsage), ...inBody.sort(byUsage)].slice(0, SLASH_RESULTS_LIMIT);
}
