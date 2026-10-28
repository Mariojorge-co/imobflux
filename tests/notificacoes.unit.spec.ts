import { expect, test } from "@playwright/test";
import {
  applyTitleCount,
  buildDesktopNotification,
  classifyConversation,
  classifyIncomingMessage,
  DEFAULT_NOTIFICATION_PREFERENCES,
  IGNORE_REASON_TEXT,
  isAlreadyBeingRead,
  isFreshIncomingMessage,
  isNotifiableConversation,
  notificationPrefsKey,
  parseNotificationPreferences,
  stripTitleCount,
  type NotifiableConversation,
} from "../lib/notifications/model";

const message = { id: "m1", conversation_id: "c1", direction: "incoming", origin: "whatsapp", is_history: false };
const conversation = (overrides: Partial<NonNullable<NotifiableConversation>> = {}): NotifiableConversation => ({
  conversation_id: "c1",
  conversation_type: "individual",
  visibility: "commercial",
  operational_status: "active",
  archived_at: null,
  sla_mode: "active",
  participant_name: "Maria",
  ...overrides,
});

test.describe("Notificações — quais mensagens contam", () => {
  test("mensagem nova do cliente conta", () => {
    expect(isFreshIncomingMessage(message)).toBe(true);
  });

  test("não conta: enviada por nós (CRM ou celular), histórico, escondida, apagada ou sem dados", () => {
    expect(isFreshIncomingMessage({ ...message, direction: "outgoing" })).toBe(false);
    expect(isFreshIncomingMessage({ ...message, origin: "crm" })).toBe(false);
    expect(isFreshIncomingMessage({ ...message, is_history: true })).toBe(false);
    expect(isFreshIncomingMessage({ ...message, hidden_at: "2026-10-16T10:00:00Z" })).toBe(false);
    expect(isFreshIncomingMessage({ ...message, deleted_at: "2026-10-16T10:00:00Z" })).toBe(false);
    expect(isFreshIncomingMessage({ ...message, id: null })).toBe(false);
    expect(isFreshIncomingMessage(null)).toBe(false);
  });
});

test.describe("Notificações — quais conversas contam", () => {
  test("conversa aberta e visível conta", () => {
    expect(isNotifiableConversation(conversation())).toBe(true);
  });

  test("não conta: invisível (nula), arquivada, prazo desativado, conversa consigo mesmo e grupo não liberado", () => {
    expect(isNotifiableConversation(null)).toBe(false);
    expect(isNotifiableConversation(conversation({ archived_at: "2026-10-01T00:00:00Z" }))).toBe(false);
    expect(isNotifiableConversation(conversation({ operational_status: "archived" }))).toBe(false);
    expect(isNotifiableConversation(conversation({ sla_mode: "disabled" }))).toBe(false);
    expect(isNotifiableConversation(conversation({ is_self: true }))).toBe(false);
    expect(isNotifiableConversation(conversation({ conversation_type: "group", visibility: "owner_only" }))).toBe(false);
  });

  test("prazo PAUSADO avisa (a pausa dura só até o cliente falar de novo); desativado avisa só se a pessoa pedir", () => {
    expect(isNotifiableConversation(conversation({ sla_mode: "paused" }))).toBe(true);
    expect(isNotifiableConversation(conversation({ sla_mode: "disabled" }), { includeDisabled: true })).toBe(true);
    // Mesmo pedindo, a conversa consigo mesmo continua em silêncio.
    expect(isNotifiableConversation(conversation({ sla_mode: "disabled", is_self: true }), { includeDisabled: true })).toBe(false);
  });

  test("cada recusa tem um motivo com texto legível (sem texto de mensagem)", () => {
    expect(classifyIncomingMessage({ ...message, direction: "outgoing" })).toBe("sent_by_team");
    expect(classifyIncomingMessage({ ...message, origin: "crm" })).toBe("sent_by_team");
    expect(classifyIncomingMessage({ ...message, is_history: true })).toBe("history");
    expect(classifyIncomingMessage({ ...message, deleted_at: "2026-10-16T10:00:00Z" })).toBe("hidden");
    expect(classifyIncomingMessage(null)).toBe("invalid");
    expect(classifyIncomingMessage(message)).toBeNull();
    expect(classifyConversation(null)).toBe("invisible");
    expect(classifyConversation(conversation({ archived_at: "2026-10-01T00:00:00Z" }))).toBe("archived");
    expect(classifyConversation(conversation({ sla_mode: "disabled" }))).toBe("sla_disabled");
    expect(classifyConversation(conversation({ is_self: true }))).toBe("self_chat");
    expect(classifyConversation(conversation({ conversation_type: "group", visibility: "owner_only" }))).toBe("group_owner_only");
    for (const text of Object.values(IGNORE_REASON_TEXT)) expect(text.length).toBeGreaterThan(5);
  });

  test("grupo liberado à equipe conta", () => {
    expect(isNotifiableConversation(conversation({ conversation_type: "group", visibility: "commercial" }))).toBe(true);
  });

  test("quem está olhando a própria conversa com a aba em foco não é avisado; em outra conversa ou aba em segundo plano, é", () => {
    expect(isAlreadyBeingRead("c1", { tabFocused: true, openConversationId: "c1" })).toBe(true);
    expect(isAlreadyBeingRead("c1", { tabFocused: true, openConversationId: "c2" })).toBe(false);
    expect(isAlreadyBeingRead("c1", { tabFocused: false, openConversationId: "c1" })).toBe(false);
  });
});

test.describe("Notificações — título e aviso do sistema", () => {
  test("contador no título, sem empilhar e sem passar de 99+", () => {
    expect(applyTitleCount("Conversas", 3)).toBe("(3) Conversas");
    expect(applyTitleCount("(3) Conversas", 4)).toBe("(4) Conversas");
    expect(applyTitleCount("(4) Conversas", 0)).toBe("Conversas");
    expect(applyTitleCount("Conversas", 250)).toBe("(99+) Conversas");
    expect(stripTitleCount("(99+) Conversas")).toBe("Conversas");
    expect(stripTitleCount("(Plantão) Conversas")).toBe("(Plantão) Conversas");
  });

  test("prévia escondida não vaza nome nem texto; prévia normal corta texto longo", () => {
    const hidden = buildDesktopNotification("Maria Silva", "Quero o apartamento 302", true);
    expect(JSON.stringify(hidden)).not.toContain("Maria");
    expect(JSON.stringify(hidden)).not.toContain("apartamento");
    const shown = buildDesktopNotification("Maria Silva", "x".repeat(300), false);
    expect(shown.title).toBe("Maria Silva");
    expect(shown.body.length).toBeLessThanOrEqual(120);
    expect(buildDesktopNotification(null, "", false)).toEqual({ title: "Nova mensagem", body: "Enviou uma mensagem." });
  });
});

test.describe("Notificações — preferências pessoais", () => {
  test("valor ausente, quebrado ou estranho volta ao padrão sem erro", () => {
    expect(parseNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(parseNotificationPreferences("não é json")).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(parseNotificationPreferences("7")).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  test("lê o que foi guardado e limita o volume entre 0 e 1", () => {
    const prefs = parseNotificationPreferences(JSON.stringify({ sound: true, volume: 7, desktop: true, hidePreview: true, includeDisabled: true }));
    expect(prefs).toEqual({ sound: true, volume: 1, desktop: true, hidePreview: true, includeDisabled: true });
    expect(parseNotificationPreferences(JSON.stringify({ sound: "sim", volume: -3 }))).toMatchObject({ sound: false, volume: 0 });
  });

  test("cada pessoa tem a própria chave", () => {
    expect(notificationPrefsKey("a")).not.toBe(notificationPrefsKey("b"));
  });

  test("som e aviso do sistema começam desligados (ninguém é surpreendido)", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.sound).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.desktop).toBe(false);
  });
});

test.describe("Notificações — o que funciona em cada aparelho", () => {
  test("reconhece iPhone, iPad moderno, Android e computador; instalado só importa no iPhone", async () => {
    const { detectPlatform, detectDeviceSupport, deviceSummary, DEVICE_GUIDES } = await import("../lib/notifications/device");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("desktop");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
    expect(deviceSummary(detectDeviceSupport("iPhone", 5, false))).toContain("instalar o ImobFlux na tela inicial");
    expect(deviceSummary(detectDeviceSupport("iPhone", 5, true))).toContain("instalado");
    expect(DEVICE_GUIDES.map((guide) => guide.platform)).toEqual(["desktop", "android", "ios"]);
  });
});
