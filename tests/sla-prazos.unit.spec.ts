import { expect, test } from "@playwright/test";
import { calculateSLA, DEFAULT_SLA_SETTINGS, formatLimit, type SlaSettings } from "../lib/conversations/sla";
import {
  conversationHasSla,
  conversationPatchFromMessage,
  describeConversationSla,
  describeSlaFor,
} from "../lib/conversations/sla-display";
import {
  parseSlaSettings,
  splitMinutes,
  toMinutes,
  validateSlaSettings,
} from "../lib/conversations/sla-settings";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const sla = (direction: string, minutes: number, settings: SlaSettings = DEFAULT_SLA_SETTINGS) => calculateSLA(direction, ago(minutes), settings, NOW);

test.describe("prazo: limites padrão (os valores atuais de Cliente aguardando + follow-up 6/24/72 h)", () => {
  test("padrões", () => {
    expect(DEFAULT_SLA_SETTINGS).toEqual({
      teamGreenUntil: 10, teamYellowUntil: 15, teamOrangeUntil: 30, teamRedUntil: 1440,
      followup1: 360, followup2: 1440, followup3: 4320,
    });
  });

  test("Cliente aguardando: verde < 10 min, amarelo < 15, laranja < 30, vermelho < 24 h, depois vermelho grave", () => {
    expect(sla("incoming", 9)).toMatchObject({ type: "team_waiting", level: "normal" });
    expect(sla("incoming", 10)?.level).toBe("attention");
    expect(sla("incoming", 14)?.level).toBe("attention");
    expect(sla("incoming", 15)?.level).toBe("priority");
    expect(sla("incoming", 29)?.level).toBe("priority");
    expect(sla("incoming", 30)?.level).toBe("critical");
    expect(sla("incoming", 1439)?.level).toBe("critical");
    expect(sla("incoming", 1440)?.level).toBe("critical_grave");
    expect(sla("incoming", 12)?.badgeText).toBe("Cliente aguardando há 12 min");
    expect(sla("incoming", 125)?.badgeText).toBe("Cliente aguardando há 2h");
    expect(sla("incoming", 3 * 1440)?.badgeText).toBe("Cliente aguardando há 3 dias");
  });

  test("Aguardando cliente: abaixo de 6 h é recente; 6 h, 24 h e 72 h são os níveis de follow-up", () => {
    expect(sla("outgoing", 20 * 60 - 19 * 60)).toMatchObject({ type: "client_waiting", level: "recent", followupLevel: 0 });
    expect(sla("outgoing", 359)?.followupLevel).toBe(0);
    expect(sla("outgoing", 360)).toMatchObject({ level: "followup_1", followupLevel: 1 });
    expect(sla("outgoing", 1439)?.followupLevel).toBe(1);
    expect(sla("outgoing", 1440)).toMatchObject({ level: "followup_2", followupLevel: 2 });
    expect(sla("outgoing", 4319)?.followupLevel).toBe(2);
    expect(sla("outgoing", 4320)).toMatchObject({ level: "followup_3", followupLevel: 3 });
    expect(sla("outgoing", 20 * 60)?.followupLevel).toBe(1); // a conversa de ~20 h do relato agora aparece (acima de 6 h)
    expect(sla("outgoing", 20 * 60)?.badgeText).toBe("Aguardando cliente há 20h (follow-up)");
    expect(sla("outgoing", 60)?.badgeText).toBe("Aguardando cliente há 1h");
  });

  test("sem mensagem, direção desconhecida ou data inválida: sem prazo", () => {
    expect(calculateSLA(null, ago(5), DEFAULT_SLA_SETTINGS, NOW)).toBeNull();
    expect(calculateSLA("incoming", null, DEFAULT_SLA_SETTINGS, NOW)).toBeNull();
    expect(calculateSLA("incoming", "lixo", DEFAULT_SLA_SETTINGS, NOW)).toBeNull();
  });
});

test.describe("prazo: limites configurados", () => {
  const custom: SlaSettings = { teamGreenUntil: 5, teamYellowUntil: 20, teamOrangeUntil: 45, teamRedUntil: 720, followup1: 120, followup2: 600, followup3: 2880 };

  test("Cliente aguardando usa os limites do workspace", () => {
    expect(sla("incoming", 4, custom)?.level).toBe("normal");
    expect(sla("incoming", 12, custom)?.level).toBe("attention");
    expect(sla("incoming", 30, custom)?.level).toBe("priority");
    expect(sla("incoming", 200, custom)?.level).toBe("critical");
    expect(sla("incoming", 800, custom)?.level).toBe("critical_grave");
  });

  test("follow-up usa os três níveis do workspace", () => {
    expect(sla("outgoing", 100, custom)?.followupLevel).toBe(0);
    expect(sla("outgoing", 120, custom)?.followupLevel).toBe(1);
    expect(sla("outgoing", 600, custom)?.followupLevel).toBe(2);
    expect(sla("outgoing", 2880, custom)?.followupLevel).toBe(3);
  });

  test("a cor do crachá acompanha os níveis configurados", () => {
    const at = (minutes: number) => describeSlaFor("incoming", new Date(Date.now() - minutes * 60_000).toISOString(), custom)?.tone;
    expect(at(3)).toBe("green");
    expect(at(10)).toBe("yellow");
    expect(at(30)).toBe("orange");
    expect(at(100)).toBe("red");
  });

  test("texto dos limites em português: 6 h, 24 h, 72 h, 30 min, 1 h 30 min, dias", () => {
    expect(formatLimit(30)).toBe("30 min");
    expect(formatLimit(360)).toBe("6 h");
    expect(formatLimit(1440)).toBe("24 h");
    expect(formatLimit(4320)).toBe("72 h");
    expect(formatLimit(90)).toBe("1 h 30 min");
    expect(formatLimit(10080)).toBe("7 dias");
    expect(formatLimit(43200)).toBe("30 dias");
  });
});

test.describe("prazo: quem tem e quem não tem", () => {
  const base = { sla_direction: "incoming", sla_at: ago(30) };
  const display = (extra: Record<string, unknown>) => describeConversationSla({ ...base, ...extra } as never);

  test("conversa comum tem prazo", () => {
    expect(display({ conversation_type: "individual" })).not.toBeNull();
    expect(conversationHasSla({ conversation_type: "individual", sla_mode: "active", sla_applies: true })).toBe(true);
  });

  test("GRUPO nunca tem prazo, mesmo que os campos de prazo venham preenchidos", () => {
    expect(display({ conversation_type: "group" })).toBeNull();
    expect(conversationHasSla({ conversation_type: "group" })).toBe(false);
  });

  test("conversa consigo mesmo nunca tem prazo", () => {
    expect(display({ conversation_type: "individual", is_self: true })).toBeNull();
    expect(conversationHasSla({ is_self: true })).toBe(false);
  });

  test("prazo desativado ou pausado (o banco já decidiu) não mostra contador; encerrada também não", () => {
    expect(display({ sla_mode: "disabled" })).toBeNull();
    expect(display({ sla_mode: "paused", sla_applies: false })).toBeNull();
    expect(display({ sla_mode: "paused", sla_applies: true })).not.toBeNull(); // o cliente já falou depois da pausa
    expect(display({ archived_at: ago(5) })).toBeNull();
  });
});

test.describe("prazo: atualização da tela quando chega mensagem (pausa, desativação, retomada)", () => {
  const incoming = (minutesAgo: number) => ({ direction: "incoming", status: "received", occurred_at: ago(minutesAgo), is_history: false });
  const outgoing = (minutesAgo: number) => ({ direction: "outgoing", status: "sent", occurred_at: ago(minutesAgo), is_history: false });
  const PAUSED_AT = ago(60);

  test("conversa ativa: a mensagem passa a ser a base do prazo", () => {
    expect(conversationPatchFromMessage({ conversation_type: "individual", sla_mode: "active", sla_applies: true }, incoming(1))).toMatchObject({ sla_direction: "incoming" });
  });

  test("grupo e conversa consigo mesmo: nunca ganham prazo por mensagem nova", () => {
    expect(conversationPatchFromMessage({ conversation_type: "group" }, incoming(1)).sla_direction).toBeUndefined();
    expect(conversationPatchFromMessage({ conversation_type: "individual", is_self: true }, incoming(1)).sla_direction).toBeUndefined();
  });

  test("desativado: nem mensagem do cliente traz o prazo de volta", () => {
    expect(conversationPatchFromMessage({ conversation_type: "individual", sla_mode: "disabled", sla_applies: false }, incoming(1)).sla_direction).toBeUndefined();
  });

  test("pausado: mensagem NOSSA ou do cliente ANTES da pausa não retomam; do cliente DEPOIS da pausa retoma sozinho", () => {
    const paused = { conversation_type: "individual", sla_mode: "paused", sla_paused_at: PAUSED_AT, sla_applies: false };
    expect(conversationPatchFromMessage(paused, outgoing(1)).sla_direction).toBeUndefined();
    expect(conversationPatchFromMessage(paused, incoming(120)).sla_direction).toBeUndefined();
    const resumed = conversationPatchFromMessage(paused, incoming(1));
    expect(resumed).toMatchObject({ sla_direction: "incoming", sla_applies: true });
  });

  test("depois de retomada, a resposta da equipe passa a contar (aguardando cliente)", () => {
    const resumedConversation = { conversation_type: "individual", sla_mode: "paused", sla_paused_at: PAUSED_AT, sla_applies: true };
    expect(conversationPatchFromMessage(resumedConversation, outgoing(0))).toMatchObject({ sla_direction: "outgoing" });
  });

  test("mensagem do cliente que falhou ou é histórico não retoma a conversa pausada", () => {
    const paused = { conversation_type: "individual", sla_mode: "paused", sla_paused_at: PAUSED_AT, sla_applies: false };
    expect(conversationPatchFromMessage(paused, { ...incoming(1), is_history: true }).sla_direction).toBeUndefined();
    expect(conversationPatchFromMessage(paused, { ...incoming(1), status: "failed" }).sla_direction).toBeUndefined();
  });
});

test.describe("prazo: configuração (validação, leitura e unidades)", () => {
  test("validação: cada nível maior que o anterior, 1 minuto a 30 dias", () => {
    expect(validateSlaSettings(DEFAULT_SLA_SETTINGS).ok).toBe(true);
    expect(validateSlaSettings({ ...DEFAULT_SLA_SETTINGS, teamYellowUntil: 10 }).ok).toBe(false);
    expect(validateSlaSettings({ ...DEFAULT_SLA_SETTINGS, teamGreenUntil: 0 }).ok).toBe(false);
    expect(validateSlaSettings({ ...DEFAULT_SLA_SETTINGS, followup2: 360 }).ok).toBe(false);
    expect(validateSlaSettings({ ...DEFAULT_SLA_SETTINGS, followup3: 43201 }).ok).toBe(false);
    expect(validateSlaSettings({ ...DEFAULT_SLA_SETTINGS, teamGreenUntil: Number.NaN }).ok).toBe(false);
    expect(validateSlaSettings({ ...DEFAULT_SLA_SETTINGS, teamGreenUntil: 1.5 }).ok).toBe(false);
    const bad = validateSlaSettings({ ...DEFAULT_SLA_SETTINGS, followup1: 5000 });
    expect(bad.ok ? "" : bad.error).toMatch(/follow-up/);
  });

  test("leitura da resposta do banco; lixo ou fora de ordem volta aos padrões", () => {
    expect(parseSlaSettings({ team_green_until_minutes: 5, team_yellow_until_minutes: 20, team_orange_until_minutes: 45, team_red_until_minutes: 720, followup_level1_minutes: 120, followup_level2_minutes: 600, followup_level3_minutes: 2880, is_default: false })).toEqual({
      teamGreenUntil: 5, teamYellowUntil: 20, teamOrangeUntil: 45, teamRedUntil: 720, followup1: 120, followup2: 600, followup3: 2880,
    });
    expect(parseSlaSettings(null)).toEqual(DEFAULT_SLA_SETTINGS);
    expect(parseSlaSettings({ team_green_until_minutes: "x" })).toEqual(DEFAULT_SLA_SETTINGS);
    expect(parseSlaSettings({ followup_level1_minutes: 5000 })).toEqual(DEFAULT_SLA_SETTINGS);
  });

  test("unidades: a maior unidade exata para preencher o formulário", () => {
    expect(splitMinutes(1440)).toEqual({ value: 1, unit: "d" });
    expect(splitMinutes(360)).toEqual({ value: 6, unit: "h" });
    expect(splitMinutes(90)).toEqual({ value: 90, unit: "min" });
    expect(splitMinutes(4320)).toEqual({ value: 3, unit: "d" });
    expect(toMinutes(6, "h")).toBe(360);
    expect(toMinutes(1.5, "h")).toBe(90);
    expect(toMinutes(2, "d")).toBe(2880);
  });
});
