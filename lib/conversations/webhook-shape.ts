// Diagnóstico do webhook SEM conteúdo: descreve só a FORMA do payload (nomes das chaves e o tipo de cada valor), nunca os
// valores. Serve para descobrir, no log, como a Evolution entrega edição, exclusão, reação e resposta citada de verdade,
// sem expor texto de mensagem, número, nome ou segredo.

const MAX_DEPTH = 7;
const MAX_KEYS = 24;
const MAX_LENGTH = 1800;

function typeLetter(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "arr";
  switch (typeof value) {
    case "string":
      return "s";
    case "number":
      return "n";
    case "boolean":
      return "b";
    default:
      return "o";
  }
}

/** `{key:{remoteJid:s,fromMe:b,id:s},message:{conversation:s}}` — só chaves e tipos. */
export function describeShape(value: unknown, depth = 0): string {
  if (value === null || typeof value !== "object") return typeLetter(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? "arr[]" : `arr(${value.length})[${depth >= MAX_DEPTH ? "…" : describeShape(value[0], depth + 1)}]`;
  }
  if (depth >= MAX_DEPTH) return "{…}";
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS);
  const body = entries.map(([key, child]) => `${key}:${describeShape(child, depth + 1)}`).join(",");
  return `{${body}}`;
}

/** Linha de log pronta: evento + tipo do resultado + forma (cortada). Nunca valores. */
export function webhookShapeLine(event: string, kind: string, data: unknown): string {
  const shape = describeShape(data);
  const safeEvent = String(event).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40);
  const safeKind = String(kind).replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40);
  return `[webhook-shape] event=${safeEvent} kind=${safeKind} shape=${shape.length > MAX_LENGTH ? `${shape.slice(0, MAX_LENGTH)}…` : shape}`;
}
