import { DEFAULT_SLA_SETTINGS, MAX_SLA_MINUTES, type SlaSettings } from "@/lib/conversations/sla";

/** Campos dos limites, na ordem da tela de Configurações > Prazos. */
export const SLA_SETTING_FIELDS: ReadonlyArray<{
  key: keyof SlaSettings;
  group: "team" | "followup";
  label: string;
  help: string;
}> = [
  { key: "teamGreenUntil", group: "team", label: "Verde até", help: "Cliente aguardando: tempo em que ainda está tudo bem." },
  { key: "teamYellowUntil", group: "team", label: "Amarelo até", help: "Cliente aguardando: atenção." },
  { key: "teamOrangeUntil", group: "team", label: "Laranja até", help: "Cliente aguardando: prioridade." },
  { key: "teamRedUntil", group: "team", label: "Vermelho até", help: "Cliente aguardando: crítico; depois disso, vermelho grave." },
  { key: "followup1", group: "followup", label: "1º nível (amarelo)", help: "Cliente parado depois da nossa mensagem. A partir daqui a conversa entra no painel de follow-up." },
  { key: "followup2", group: "followup", label: "2º nível (laranja)", help: "Follow-up mais urgente." },
  { key: "followup3", group: "followup", label: "3º nível (vermelho)", help: "Follow-up muito atrasado." },
];

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SLA_MINUTES ? value : null;
}

/** Lê o que a função get_sla_settings devolve; qualquer campo inválido volta ao padrão. */
export function parseSlaSettings(payload: unknown): SlaSettings {
  const data = (payload ?? {}) as Record<string, unknown>;
  const read = (key: string, fallback: number) => positiveInteger(data[key]) ?? fallback;
  const candidate: SlaSettings = {
    teamGreenUntil: read("team_green_until_minutes", DEFAULT_SLA_SETTINGS.teamGreenUntil),
    teamYellowUntil: read("team_yellow_until_minutes", DEFAULT_SLA_SETTINGS.teamYellowUntil),
    teamOrangeUntil: read("team_orange_until_minutes", DEFAULT_SLA_SETTINGS.teamOrangeUntil),
    teamRedUntil: read("team_red_until_minutes", DEFAULT_SLA_SETTINGS.teamRedUntil),
    followup1: read("followup_level1_minutes", DEFAULT_SLA_SETTINGS.followup1),
    followup2: read("followup_level2_minutes", DEFAULT_SLA_SETTINGS.followup2),
    followup3: read("followup_level3_minutes", DEFAULT_SLA_SETTINGS.followup3),
  };
  // Valores fora de ordem (não deveria acontecer: o banco recusa) não são usados.
  return validateSlaSettings(candidate).ok ? candidate : DEFAULT_SLA_SETTINGS;
}

export type SlaSettingsValidation = { ok: true } | { ok: false; error: string };

/** Mesmas regras do banco: cada nível maior que o anterior, de 1 minuto a 30 dias. */
export function validateSlaSettings(settings: SlaSettings): SlaSettingsValidation {
  const values = Object.values(settings);
  if (values.some((value) => !Number.isInteger(value) || value < 1)) return { ok: false, error: "Use números inteiros a partir de 1 minuto." };
  if (values.some((value) => value > MAX_SLA_MINUTES)) return { ok: false, error: "O limite máximo é 30 dias." };
  if (!(settings.teamGreenUntil < settings.teamYellowUntil && settings.teamYellowUntil < settings.teamOrangeUntil && settings.teamOrangeUntil < settings.teamRedUntil)) {
    return { ok: false, error: "Em \"Cliente aguardando\", cada nível precisa ser maior que o anterior (verde < amarelo < laranja < vermelho)." };
  }
  if (!(settings.followup1 < settings.followup2 && settings.followup2 < settings.followup3)) {
    return { ok: false, error: "No follow-up, cada nível precisa ser maior que o anterior (1º < 2º < 3º)." };
  }
  return { ok: true };
}

export type TimeUnit = "min" | "h" | "d";
export const UNIT_MINUTES: Record<TimeUnit, number> = { min: 1, h: 60, d: 1440 };

/** Divide minutos na maior unidade exata (60 → 1 h; 1440 → 1 dia; 90 → 90 min) para preencher o formulário. */
export function splitMinutes(minutes: number): { value: number; unit: TimeUnit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "d" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "h" };
  return { value: minutes, unit: "min" };
}

export function toMinutes(value: number, unit: TimeUnit): number {
  return Math.round(value * UNIT_MINUTES[unit]);
}
