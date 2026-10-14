import { calculateSLA, type SLAInfo } from "./sla";

export type SlaTone = "green" | "yellow" | "orange" | "red" | "neutral";

const TEAM_TONE: Record<string, SlaTone> = {
  normal: "green",
  attention: "yellow",
  priority: "orange",
  critical: "red",
  critical_grave: "red",
};

const CLIENT_TONE: Record<string, SlaTone> = {
  recent: "neutral",
  waiting_client: "neutral",
  attention: "yellow",
  followup_candidate: "orange",
};

export const SLA_TONE_CLASS: Record<SlaTone, string> = {
  green: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  yellow: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  orange: "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-400",
  red: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400",
  neutral: "border-border bg-neutral-soft text-text-muted",
};

export type SlaDisplay = {
  tone: SlaTone;
  /** Texto curto para o card: "12 min", "3 h", "2 d". */
  shortLabel: string;
  /** Frase completa para leitores de tela e tooltip. */
  fullLabel: string;
  /** true quando a equipe deve resposta (cliente esperando). */
  teamWaiting: boolean;
  /** true quando exige ação imediata (vermelho). */
  urgent: boolean;
};

function shortTime(sla: SLAInfo): string {
  if (sla.daysWaiting >= 1) return `${sla.daysWaiting} d`;
  if (sla.hoursWaiting >= 1) return `${sla.hoursWaiting} h`;
  return `${sla.minutesWaiting} min`;
}

export function describeSla(sla: SLAInfo | null): SlaDisplay | null {
  if (!sla) return null;
  const teamWaiting = sla.type === "team_waiting";
  const tone = (teamWaiting ? TEAM_TONE : CLIENT_TONE)[sla.level] ?? "neutral";
  return {
    tone,
    shortLabel: shortTime(sla),
    fullLabel: sla.badgeText,
    teamWaiting,
    urgent: tone === "red",
  };
}

export function describeSlaFor(
  direction: string | null | undefined,
  lastActivityAt: string | null | undefined,
): SlaDisplay | null {
  return describeSla(calculateSLA(direction ?? null, lastActivityAt ?? null));
}

// ─── Fonte única do contador de espera (lista, cabeçalho, Prioridades) ────────────────────────────────

/** Campos da conversa que decidem se há contador de espera e qual. */
export type ConversationSlaInput = {
  archived_at?: string | null;
  operational_status?: string | null;
  /** Direção da última mensagem VÁLIDA (resposta que falhou e histórico não contam). */
  sla_direction?: string | null;
  /** Hora dessa mensagem. */
  sla_at?: string | null;
};

/** Conversa encerrada = arquivada. Encerrada não tem contador em lugar nenhum e não conta como atrasada. */
export function isConversationClosed(conversation: Pick<ConversationSlaInput, "archived_at" | "operational_status">): boolean {
  return Boolean(conversation.archived_at) || conversation.operational_status === "archived";
}

/**
 * O contador de espera de uma conversa: "Cliente aguardando há X" (cliente escreveu por último) ou "Aguardando cliente
 * há X" (nós escrevemos por último), nos dois sentidos. Conversa encerrada ou sem mensagem válida: sem contador.
 */
export function describeConversationSla(conversation: ConversationSlaInput | null | undefined): SlaDisplay | null {
  if (!conversation || isConversationClosed(conversation)) return null;
  return describeSlaFor(conversation.sla_direction, conversation.sla_at);
}

type SlaCandidate = {
  id?: string;
  direction: string;
  status: string;
  occurred_at: string;
  is_history?: boolean;
};

const PENDING_PREFIX = "pending-";

/** Uma mensagem conta para o contador? Falhou, é histórico importado ou ainda é provisória: não conta. */
export function countsForSla(message: SlaCandidate): boolean {
  if (message.status === "failed" || message.status === "sending") return false;
  if (message.is_history) return false;
  if (message.id?.startsWith(PENDING_PREFIX)) return false;
  return message.direction === "incoming" || message.direction === "outgoing";
}

/** A mensagem mais recente que conta para o contador (entre as de uma lista em qualquer ordem). */
export function pickSlaMessage<T extends SlaCandidate>(messages: readonly T[]): T | null {
  let best: T | null = null;
  for (const message of messages) {
    if (!countsForSla(message)) continue;
    if (!best || message.occurred_at.localeCompare(best.occurred_at) > 0) best = message;
  }
  return best;
}

/** Atualização de sla_direction/sla_at quando chega uma mensagem; vazio quando ela não conta. */
export function slaPatchFromMessage(message: SlaCandidate): Pick<ConversationSlaInput, "sla_direction" | "sla_at"> {
  return countsForSla(message) ? { sla_direction: message.direction, sla_at: message.occurred_at } : {};
}

/**
 * O que muda na conversa (lista e cabeçalho) quando uma mensagem nova chega: o contador passa a contar a partir dela
 * (se ela conta) e mensagem do CLIENTE numa conversa encerrada a reabre (o banco já reabriu; isto só alinha a tela).
 */
export type ConversationSlaPatch = {
  sla_direction?: string | null;
  sla_at?: string | null;
  archived_at?: null;
  operational_status?: string;
};

export function conversationPatchFromMessage(
  conversation: Pick<ConversationSlaInput, "archived_at" | "operational_status">,
  message: SlaCandidate,
): ConversationSlaPatch {
  const patch: ConversationSlaPatch = { ...slaPatchFromMessage(message) };
  // Só reabre se a mensagem é POSTERIOR ao encerramento: reler uma mensagem antiga do cliente (que já estava lá
  // quando a conversa foi encerrada) nunca reabre.
  const closedAt = conversation.archived_at ? Date.parse(conversation.archived_at) : Number.NaN;
  const arrivedAfterClose = Number.isNaN(closedAt) || Date.parse(message.occurred_at) > closedAt;
  if (message.direction === "incoming" && !message.is_history && isConversationClosed(conversation) && arrivedAfterClose) {
    patch.archived_at = null;
    patch.operational_status = "active";
  }
  return patch;
}
