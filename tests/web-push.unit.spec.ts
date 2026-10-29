import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import webpush from "web-push";
import { readVapidConfig } from "../lib/push/config";
import { MAX_TARGETS, deliverPush, isGoneStatus, summaryLine, type DeliveryDeps, type PushTarget, type SendOutcome } from "../lib/push/delivery";
import { decidePushState, describeDevice, reenableSteps, urlBase64ToUint8Array, type PushCapabilities } from "../lib/push/devices";
import { buildMessagePayload, buildTestPayload, cleanContactName } from "../lib/push/payload";
import { isValidEndpoint, parseSubscriptionBody } from "../lib/push/validate";

// Web Push — regras puras: chaves, conteúdo do aviso (sem prévia), validação, envio sem repetição e estados da tela.
// Par VAPID descartável gerado em memória (nunca impresso nem gravado).
const vapid = webpush.generateVAPIDKeys();
const CONVERSATION = "11111111-2222-4333-8444-555555555555";

function target(index: number, overrides: Partial<PushTarget> = {}): PushTarget {
  return {
    subscription_id: `sub-${index}`,
    member_id: "member-1",
    endpoint: `https://push.example.test/secret-endpoint-${index}`,
    p256dh: "p256dh-key",
    auth: "auth-key",
    conversation_id: CONVERSATION,
    contact_name: "Maria Souza",
    ...overrides,
  };
}

function deps(outcomes: Record<string, SendOutcome | "throw">, calls: { gone: string[]; error: string[]; bodies: string[] }): DeliveryDeps {
  return {
    send: async (item, body) => {
      calls.bodies.push(body);
      const outcome = outcomes[item.subscription_id] ?? { ok: true };
      if (outcome === "throw") throw new Error("falha de rede com segredo https://push.example.test/secret-endpoint");
      return outcome;
    },
    markGone: async (ids) => void calls.gone.push(...ids),
    markError: async (ids) => void calls.error.push(...ids),
  };
}

test.describe("Web Push — chaves VAPID", () => {
  const env = { NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:contato@example.test" };

  test("com as três variáveis válidas o recurso liga", () => {
    expect(readVapidConfig(env)).toEqual({ publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "mailto:contato@example.test" });
    expect(readVapidConfig({ ...env, VAPID_SUBJECT: "https://imobflux.example.test" })).not.toBeNull();
  });

  test("sem qualquer variável, ou com valor inválido, fica desligado (nunca lança)", () => {
    expect(readVapidConfig({})).toBeNull();
    for (const key of Object.keys(env)) expect(readVapidConfig({ ...env, [key]: undefined })).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_SUBJECT: "contato@example.test" })).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_SUBJECT: "http://inseguro.example.test" })).toBeNull();
    expect(readVapidConfig({ ...env, VAPID_PRIVATE_KEY: "curta" })).toBeNull();
    expect(readVapidConfig({ ...env, NEXT_PUBLIC_VAPID_PUBLIC_KEY: `${vapid.publicKey}+` })).toBeNull();
  });

  test("a chave pública vira os 65 bytes que o navegador pede", () => {
    expect(urlBase64ToUint8Array(vapid.publicKey)).toHaveLength(65);
  });
});

test.describe("Web Push — conteúdo do aviso (sem prévia)", () => {
  test("título com o nome do contato, texto fixo, caminho e etiqueta da conversa", () => {
    const payload = buildMessagePayload(CONVERSATION, "Maria Souza");
    expect(payload).toEqual({
      kind: "message",
      title: "Nova mensagem de Maria Souza",
      body: "Toque para abrir a conversa.",
      path: `/conversas/${CONVERSATION}`,
      tag: `conversa-${CONVERSATION}`,
    });
  });

  test("o conteúdo do aviso não tem como carregar o texto da mensagem", () => {
    // buildMessagePayload só recebe o id e o nome: não existe parâmetro para o texto.
    expect(buildMessagePayload.length).toBe(2);
    expect(JSON.stringify(buildMessagePayload(CONVERSATION, "Ana"))).not.toMatch(/text|preview|prévia/i);
  });

  test("nome sujo é limpo: controle, invisíveis, espaços e tamanho; vazio vira 'contato'", () => {
    expect(cleanContactName("  Ana\u0000‮  Paula \n Lima ")).toBe("Ana Paula Lima");
    expect(cleanContactName("")).toBe("contato");
    expect(cleanContactName(null)).toBe("contato");
    expect(cleanContactName("​ ⁦")).toBe("contato");
    expect(cleanContactName("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });

  test("id de conversa inválido não monta caminho nem etiqueta com lixo", () => {
    const payload = buildMessagePayload("../../admin", "Ana");
    expect(payload.path).toBe("/conversas");
    expect(payload.tag).toBe("imobflux-aviso");
  });

  test("aviso de teste não cita conversa nem cliente", () => {
    const payload = buildTestPayload();
    expect(payload.kind).toBe("test");
    expect(payload.path).toBe("/preferencias");
  });
});

test.describe("Web Push — validação do aparelho", () => {
  const keys = { p256dh: vapid.publicKey, auth: "abcdefghijklmnopqrstuv" };
  test("aceita o formato do navegador e a plataforma informada", () => {
    expect(parseSubscriptionBody({ endpoint: "https://fcm.example.test/send/abc123", keys, platform: "android" })).toEqual({
      endpoint: "https://fcm.example.test/send/abc123",
      p256dh: keys.p256dh,
      auth: keys.auth,
      platform: "android",
    });
    expect(parseSubscriptionBody({ endpoint: "https://fcm.example.test/send/abc123", keys, platform: "pc" })?.platform).toBeNull();
  });

  test("recusa endpoint sem https, chaves ruins e corpo qualquer", () => {
    expect(parseSubscriptionBody({ endpoint: "http://fcm.example.test/send/abc123", keys })).toBeNull();
    expect(parseSubscriptionBody({ endpoint: "https://localhost/send/abc123", keys })).toBeNull();
    expect(parseSubscriptionBody({ endpoint: "https://fcm.example.test/send/abc123", keys: { p256dh: "x", auth: "y" } })).toBeNull();
    expect(parseSubscriptionBody({ endpoint: "https://fcm.example.test/send/abc123" })).toBeNull();
    expect(parseSubscriptionBody(null)).toBeNull();
    expect(parseSubscriptionBody("texto")).toBeNull();
    expect(isValidEndpoint(`https://fcm.example.test/${"a".repeat(2100)}`)).toBe(false);
  });
});

test.describe("Web Push — envio em paralelo, sem repetição", () => {
  test("404 e 410 desativam a assinatura; outra falha só marca o erro; sucesso não marca nada", async () => {
    const calls = { gone: [] as string[], error: [] as string[], bodies: [] as string[] };
    const summary = await deliverPush(
      [target(1), target(2), target(3), target(4), target(5)],
      deps({ "sub-2": { ok: false, statusCode: 410 }, "sub-3": { ok: false, statusCode: 404 }, "sub-4": { ok: false, statusCode: 500 }, "sub-5": "throw" }, calls),
    );
    expect(summary).toEqual({ targets: 5, sent: 1, gone: 2, failed: 2, codes: { "410": 1, "404": 1, "500": 1, rede: 1 } });
    expect(calls.gone.sort()).toEqual(["sub-2", "sub-3"]);
    expect(calls.error.sort()).toEqual(["sub-4", "sub-5"]);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(429)).toBe(false);
  });

  test("cada aparelho recebe UMA tentativa (nenhuma repetição) e o mesmo aparelho repetido na lista conta uma vez", async () => {
    const calls = { gone: [] as string[], error: [] as string[], bodies: [] as string[] };
    await deliverPush([target(1), target(1), target(2)], deps({ "sub-1": { ok: false, statusCode: 500 } }, calls));
    expect(calls.bodies).toHaveLength(2);
  });

  test("o corpo enviado é só o aviso sem prévia", async () => {
    const calls = { gone: [] as string[], error: [] as string[], bodies: [] as string[] };
    await deliverPush([target(1)], deps({}, calls));
    expect(JSON.parse(calls.bodies[0])).toMatchObject({ title: "Nova mensagem de Maria Souza", body: "Toque para abrir a conversa." });
  });

  test("o resumo para o log tem só contagens e códigos (nunca endpoint, nome, chave ou texto)", async () => {
    const calls = { gone: [] as string[], error: [] as string[], bodies: [] as string[] };
    const summary = await deliverPush([target(1), target(2)], deps({ "sub-1": "throw", "sub-2": { ok: false, statusCode: 410 } }, calls));
    const line = summaryLine(summary);
    expect(line).toBe("[push] aparelhos=2 enviados=0 desativados=1 falhas=1 codigos=410:1,rede:1");
    expect(line).not.toMatch(/secret|example|Maria|p256dh|auth/i);
  });

  test("respeita o teto de aparelhos por mensagem e roda tudo em paralelo", async () => {
    let active = 0;
    let peak = 0;
    const many = Array.from({ length: MAX_TARGETS + 20 }, (_, index) => target(index));
    const summary = await deliverPush(many, {
      send: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { ok: true };
      },
      markGone: async () => undefined,
      markError: async () => undefined,
    });
    expect(summary.targets).toBe(MAX_TARGETS);
    expect(peak).toBe(MAX_TARGETS);
  });

  test("falha ao marcar o estado no banco nunca derruba o envio", async () => {
    const summary = await deliverPush([target(1)], {
      send: async () => ({ ok: false, statusCode: 410 }),
      markGone: async () => {
        throw new Error("banco fora");
      },
      markError: async () => undefined,
    });
    expect(summary.gone).toBe(1);
  });

  test("sem destinatários não faz nada", async () => {
    const calls = { gone: [] as string[], error: [] as string[], bodies: [] as string[] };
    expect(await deliverPush([], deps({}, calls))).toEqual({ targets: 0, sent: 0, gone: 0, failed: 0, codes: {} });
    expect(calls.bodies).toHaveLength(0);
  });
});

test.describe("Web Push — estados da tela de Preferências", () => {
  const base: PushCapabilities = {
    configured: true,
    platform: "android",
    installed: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: "default",
    subscribed: false,
  };

  test("cada situação cai no estado certo", () => {
    expect(decidePushState({ ...base, configured: false })).toBe("unavailable");
    expect(decidePushState({ ...base, platform: "ios", installed: false, hasPushManager: false })).toBe("needs-install");
    expect(decidePushState({ ...base, platform: "ios", installed: true })).toBe("inactive");
    expect(decidePushState({ ...base, hasPushManager: false })).toBe("unsupported");
    expect(decidePushState({ ...base, permission: "denied" })).toBe("denied");
    expect(decidePushState({ ...base, permission: "granted" })).toBe("inactive");
    expect(decidePushState({ ...base, permission: "granted", subscribed: true })).toBe("active");
    expect(decidePushState({ ...base, permission: "default", subscribed: true })).toBe("inactive");
  });

  test("textos de reativar e nome do aparelho", () => {
    expect(reenableSteps("ios", true)).toContain("Ajustes do iPhone");
    expect(reenableSteps("android", false)).toContain("Notificações");
    expect(reenableSteps("desktop", false)).toContain("cadeado");
    expect(describeDevice("android", "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(describeDevice("ios", "Mozilla/5.0 (iPhone) AppleWebKit Version/17 Safari/604.1")).toBe("iPhone/iPad · Safari");
    expect(describeDevice("desktop", null)).toBe("Computador · navegador");
  });
});

test.describe("Web Push — service worker e webhook (garantias de código)", () => {
  const root = path.join(__dirname, "..");
  const worker = fs.readFileSync(path.join(root, "public", "sw-avisos.js"), "utf8");
  const webhook = fs.readFileSync(path.join(root, "app", "api", "webhooks", "whatsapp", "route.ts"), "utf8");

  test("o service worker trata push e clique, mas continua sem fetch e sem cache", () => {
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain('addEventListener("notificationclick"');
    expect(worker).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(worker).not.toMatch(/\bcaches\b/);
  });

  test("o service worker mostra SEMPRE uma notificação por push (regra do iOS) e nunca usa texto de mensagem", () => {
    expect(worker).toContain("showNotification");
    expect(worker).toContain("tag");
    expect(worker).not.toMatch(/text_content|textContent|preview/i);
  });

  test("o webhook só agenda o aviso depois da ingestão, para mensagem nova do cliente, via after()", () => {
    expect(webhook).toContain("scheduleNewMessagePush(created.message_id)");
    expect(webhook).toMatch(/created\?\.status === "success"[^\n]*!result\.fromMe/);
    const server = fs.readFileSync(path.join(root, "lib", "push", "server.ts"), "utf8");
    expect(server).toContain("after(() => notifyNewMessage(messageId))");
    expect(server).not.toMatch(/console\.(log|error)\([^)]*endpoint/);
  });
});
