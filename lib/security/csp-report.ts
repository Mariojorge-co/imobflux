// Relatório de violações da CSP (modo Report-Only): extrai SÓ a diretiva violada e a ORIGEM bloqueada.
// Nunca a URL completa, a querystring, o trecho de código nem a URL da página: esses campos podem trazer dado pessoal.

export const MAX_REPORT_BYTES = 8 * 1024;

/** Rótulo seguro de uma origem bloqueada: esquema + host (sem caminho/query), ou uma palavra-chave da CSP. */
export function blockedOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "desconhecida";
  const raw = value.trim();
  const keyword = raw.toLowerCase();
  if (["inline", "eval", "wasm-eval", "self", "trusted-types-policy", "trusted-types-sink"].includes(keyword)) return keyword;
  if (keyword.startsWith("blob:")) return "blob:";
  if (keyword.startsWith("data:")) return "data:";
  if (keyword.startsWith("filesystem:")) return "filesystem:";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:") return url.origin;
    return `${url.protocol}`;
  } catch {
    return "outra";
  }
}

export function directiveName(value: unknown): string {
  if (typeof value !== "string") return "desconhecida";
  const first = value.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[a-z-]{1,40}$/.test(first) ? first : "desconhecida";
}

export type CspViolation = { directive: string; blocked: string };

/** Aceita o formato clássico (`{ "csp-report": {...} }`) e o da Reporting API (lista de `{ type, body }`). */
export function parseCspReports(payload: unknown): CspViolation[] {
  const items: unknown[] = Array.isArray(payload) ? payload.slice(0, 10) : [payload];
  const out: CspViolation[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const body = (record["csp-report"] ?? record.body ?? record) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") continue;
    const directive = directiveName(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"] ?? body.violatedDirective);
    const blocked = blockedOrigin(body["blocked-uri"] ?? body.blockedURL ?? body.blockedUri);
    if (directive === "desconhecida" && blocked === "desconhecida") continue;
    out.push({ directive, blocked });
  }
  return out;
}

export function violationLine(violation: CspViolation): string {
  return `[csp-report] diretiva=${violation.directive} origem=${violation.blocked}`;
}

/** Limite simples de volume por instância: no máximo `limit` relatórios por janela de `windowMs`. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  let windowStart = now();
  let count = 0;
  return function allow(): boolean {
    const current = now();
    if (current - windowStart >= windowMs) {
      windowStart = current;
      count = 0;
    }
    count += 1;
    return count <= limit;
  };
}
