export type SLALevel =
  | "normal"
  | "attention"
  | "priority"
  | "critical"
  | "critical_grave"
  | "recent"
  | "waiting_client"
  | "followup_candidate";

export type SLAInfo = {
  type: "team_waiting" | "client_waiting";
  badgeText: string;
  level: SLALevel;
  minutesWaiting: number;
  hoursWaiting: number;
  daysWaiting: number;
};

/**
 * Calcula o SLA Operacional com base na direção da última mensagem e no tempo de atividade.
 */
export function calculateSLA(
  lastMsgDirection: string | null,
  lastActivityAt: string | null,
): SLAInfo | null {
  if (!lastActivityAt) return null;
  const now = Date.now();
  const last = new Date(lastActivityAt).getTime();
  if (isNaN(last)) return null;

  const diffMs = Math.max(0, now - last);
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (lastMsgDirection === "incoming") {
    // EQUIPE DEVENDO RESPOSTA
    if (diffMinutes < 10) {
      return {
        type: "team_waiting",
        badgeText: `Cliente aguardando há ${diffMinutes} min`,
        level: "normal",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    } else if (diffMinutes < 15) {
      return {
        type: "team_waiting",
        badgeText: `Cliente aguardando há ${diffMinutes} min`,
        level: "attention",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    } else if (diffMinutes < 30) {
      return {
        type: "team_waiting",
        badgeText: `Cliente aguardando há ${diffMinutes} min`,
        level: "priority",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    } else if (diffMinutes < 1440) {
      const timeStr = diffHours > 0 ? `${diffHours}h` : `${diffMinutes} min`;
      return {
        type: "team_waiting",
        badgeText: `Cliente aguardando há ${timeStr}`,
        level: "critical",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    } else {
      return {
        type: "team_waiting",
        badgeText: `Cliente aguardando há ${diffDays} dia${diffDays > 1 ? "s" : ""}`,
        level: "critical_grave",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    }
  } else if (lastMsgDirection === "outgoing") {
    // CLIENTE DEVENDO RESPOSTA
    if (diffHours < 3) {
      const timeStr = diffHours > 0 ? `${diffHours}h` : `${diffMinutes} min`;
      return {
        type: "client_waiting",
        badgeText: `Aguardando cliente há ${timeStr}`,
        level: "recent",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    } else if (diffHours <= 24) {
      return {
        type: "client_waiting",
        badgeText: `Aguardando cliente há ${diffHours}h`,
        level: "waiting_client",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    } else if (diffHours <= 48) {
      return {
        type: "client_waiting",
        badgeText: `Aguardando cliente há ${diffDays} dia${diffDays > 1 ? "s" : ""}`,
        level: "attention",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    } else {
      return {
        type: "client_waiting",
        badgeText: `Aguardando cliente há ${diffDays} dias (Follow-up)`,
        level: "followup_candidate",
        minutesWaiting: diffMinutes,
        hoursWaiting: diffHours,
        daysWaiting: diffDays,
      };
    }
  }

  return null;
}
