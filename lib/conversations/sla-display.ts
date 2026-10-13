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
