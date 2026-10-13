import { AUDIT_CATEGORIES, type AuditCategory } from "@/lib/audit/labels";

export type AuditFilters = {
  category: AuditCategory | null;
  actor: string | null;
  /** AAAA-MM-DD (dia inteiro, horário de Maceió/Brasília, UTC-3). */
  from: string | null;
  to: string | null;
  cursorTs: string | null;
  cursorId: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/;

function single(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function validDay(value: string | null): string | null {
  if (!value || !DAY.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

/** Lê e valida os filtros da URL; qualquer valor inválido é descartado (nunca chega ao banco). */
export function parseAuditFilters(params: SearchParams): AuditFilters {
  const category = single(params.categoria);
  const actor = single(params.pessoa);
  const cursorTs = single(params.cursor_ts);
  const cursorId = single(params.cursor_id);
  const validCursor = cursorTs && TIMESTAMP.test(cursorTs) && !Number.isNaN(new Date(cursorTs).getTime()) && cursorId && UUID.test(cursorId);
  return {
    category: AUDIT_CATEGORIES.some((item) => item.value === category) ? (category as AuditCategory) : null,
    actor: actor && UUID.test(actor) ? actor : null,
    from: validDay(single(params.de)),
    to: validDay(single(params.ate)),
    cursorTs: validCursor ? cursorTs : null,
    cursorId: validCursor ? cursorId : null,
  };
}

/** Início do dia (UTC-3) como instante ISO: filtro "de" é inclusivo. */
export function dayStartIso(day: string): string {
  return new Date(`${day}T00:00:00-03:00`).toISOString();
}

/** Início do dia seguinte (UTC-3): filtro "até" inclui o dia inteiro informado. */
export function dayAfterIso(day: string): string {
  return new Date(new Date(`${day}T00:00:00-03:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/** Querystring dos filtros atuais (para o link "ver mais"), com cursor opcional. */
export function auditQueryString(filters: AuditFilters, cursor?: { ts: string; id: string }): string {
  const search = new URLSearchParams();
  if (filters.category) search.set("categoria", filters.category);
  if (filters.actor) search.set("pessoa", filters.actor);
  if (filters.from) search.set("de", filters.from);
  if (filters.to) search.set("ate", filters.to);
  if (cursor) {
    search.set("cursor_ts", cursor.ts);
    search.set("cursor_id", cursor.id);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
