export type SLALevel =
  | "normal"
  | "attention"
  | "priority"
  | "critical"
  | "critical_grave"
  | "recent"
  | "followup_1"
  | "followup_2"
  | "followup_3";

export type SLAInfo = {
  type: "team_waiting" | "client_waiting";
  badgeText: string;
  level: SLALevel;
  /** Só em "aguardando cliente": 0 = abaixo do 1º nível de follow-up; 1, 2 ou 3 = nível de follow-up atingido. */
  followupLevel: 0 | 1 | 2 | 3;
  minutesWaiting: number;
  hoursWaiting: number;
  daysWaiting: number;
};

/**
 * Limites de tempo (em minutos) de um workspace. Equipe devendo resposta ("Cliente aguardando"): verde até
 * `teamGreenUntil`, amarelo até `teamYellowUntil`, laranja até `teamOrangeUntil`, vermelho até `teamRedUntil` e
 * vermelho grave depois. Follow-up ("Aguardando cliente"): três níveis de urgência a partir de cada limite.
 */
export type SlaSettings = {
  teamGreenUntil: number;
  teamYellowUntil: number;
  teamOrangeUntil: number;
  teamRedUntil: number;
  followup1: number;
  followup2: number;
  followup3: number;
};

/** Padrões: os valores que já valiam para "Cliente aguardando" e 6 h / 24 h / 72 h para o follow-up. */
export const DEFAULT_SLA_SETTINGS: SlaSettings = {
  teamGreenUntil: 10,
  teamYellowUntil: 15,
  teamOrangeUntil: 30,
  teamRedUntil: 1440,
  followup1: 360,
  followup2: 1440,
  followup3: 4320,
};

export const MAX_SLA_MINUTES = 43200;

/** "12 min", "3h" ou "2 dias": o tempo decorrido no texto do contador. */
function elapsedText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  const days = Math.floor(minutes / 1440);
  return `${days} dia${days > 1 ? "s" : ""}`;
}

/**
 * Calcula o contador de espera com base na direção da última mensagem, na hora dela e nos limites do workspace.
 * É a ÚNICA função de cálculo: lista, cabeçalho, Kanban e Prioridades passam por ela. Quando a conversa não tem prazo
 * (grupo, conversa consigo mesmo, prazo pausado/desativado), o banco entrega direção/hora nulas e o resultado é nulo.
 */
export function calculateSLA(
  lastMsgDirection: string | null,
  lastActivityAt: string | null,
  settings: SlaSettings = DEFAULT_SLA_SETTINGS,
  now: number = Date.now(),
): SLAInfo | null {
  if (!lastActivityAt) return null;
  const last = new Date(lastActivityAt).getTime();
  if (isNaN(last)) return null;

  const diffMs = Math.max(0, now - last);
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const base = { minutesWaiting: minutes, hoursWaiting: hours, daysWaiting: days };

  if (lastMsgDirection === "incoming") {
    // EQUIPE DEVENDO RESPOSTA
    const level: SLALevel =
      minutes < settings.teamGreenUntil
        ? "normal"
        : minutes < settings.teamYellowUntil
          ? "attention"
          : minutes < settings.teamOrangeUntil
            ? "priority"
            : minutes < settings.teamRedUntil
              ? "critical"
              : "critical_grave";
    return { type: "team_waiting", level, followupLevel: 0, badgeText: `Cliente aguardando há ${elapsedText(minutes)}`, ...base };
  }

  if (lastMsgDirection === "outgoing") {
    // CLIENTE DEVENDO RESPOSTA (follow-up)
    const followupLevel: 0 | 1 | 2 | 3 =
      minutes >= settings.followup3 ? 3 : minutes >= settings.followup2 ? 2 : minutes >= settings.followup1 ? 1 : 0;
    const level: SLALevel = followupLevel === 0 ? "recent" : (`followup_${followupLevel}` as SLALevel);
    const suffix = followupLevel > 0 ? " (follow-up)" : "";
    return { type: "client_waiting", level, followupLevel, badgeText: `Aguardando cliente há ${elapsedText(minutes)}${suffix}`, ...base };
  }

  return null;
}

/** "6 h", "24 h", "30 min", "1 h 30 min" ou "5 dias": um limite em minutos escrito para a pessoa. */
export function formatLimit(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  // Até 99 h fica em horas ("24 h", "72 h"); além disso, em dias.
  if (minutes < 100 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(minutes / 1440);
  const restHours = Math.floor((minutes % 1440) / 60);
  return `${days} ${days === 1 ? "dia" : "dias"}${restHours ? ` ${restHours} h` : ""}`;
}
