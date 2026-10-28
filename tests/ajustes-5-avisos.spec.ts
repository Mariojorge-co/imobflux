import { expect, test, type Page } from "@playwright/test";
import { loginAsDemoOwner, resetAndLoadDemoMode, runLocalSql } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Ajustes 5 (A): avisos de mensagem nova. Causa raiz: conversa com prazo PAUSADO era tratada como silenciada, mas "pausado" dura só
// até o cliente falar de novo. Também: painel de diagnóstico, "Testar aviso agora", permissão negada, service worker e guia por aparelho.

const JID_ACTIVE = "5582988885101@s.whatsapp.net";
const JID_PAUSED = "5582988885102@s.whatsapp.net";
const JID_DISABLED = "5582988885103@s.whatsapp.net";
let paused = "";
let disabled = "";
let counter = 0;

type Setup = { permission?: "granted" | "denied" | "default"; serviceWorker?: boolean };

async function prepare(page: Page, { permission = "granted", serviceWorker = false }: Setup = {}) {
  await page.addInitScript(
    ({ permission: perm, serviceWorker: useWorker }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__focused = true;
      w.__notifs = [];
      w.__shown = [];
      w.__events = [];
      document.hasFocus = () => w.__focused === true;
      class FakeNotification {
        static permission = perm;
        static requestPermission = async () => FakeNotification.permission;
        onclick: (() => void) | null = null;
        constructor(public title: string, public options: { body?: string } = {}) {
          (w.__notifs as unknown[]).push(this);
        }
        close() {}
      }
      (window as unknown as { Notification: unknown }).Notification = FakeNotification;
      if (!useWorker) {
        // Sem service worker: o aviso cai no `new Notification` (computador).
        Object.defineProperty(Navigator.prototype, "serviceWorker", { configurable: true, get: () => undefined });
      } else {
        // Com service worker de verdade: registra só o que o aviso mostraria (Android).
        ServiceWorkerRegistration.prototype.showNotification = async function (title: string, options?: NotificationOptions) {
          (w.__shown as unknown[]).push({ title, body: options?.body, data: options?.data });
        };
      }
      window.addEventListener("imobflux:notified", (event) => (w.__events as unknown[]).push((event as CustomEvent).detail));
    },
    { permission, serviceWorker },
  );
}

const setFocused = (page: Page, focused: boolean) =>
  page.evaluate((value) => {
    (window as unknown as Record<string, unknown>).__focused = value;
    if (value) window.dispatchEvent(new Event("focus"));
  }, focused);

const notifs = (page: Page) => page.evaluate(() => (window as unknown as { __notifs: unknown[] }).__notifs.length);
const shown = (page: Page) => page.evaluate(() => (window as unknown as { __shown: Array<{ title: string; data: { path: string } }> }).__shown);

async function waitConnected(page: Page) {
  await expect(page.getByTestId("diag-realtime")).toHaveText("conectada", { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function say(request: Parameters<typeof ingestText>[0], jid: string, name: string) {
  counter += 1;
  return ingestText(request, { jid, text: `Mensagem de teste ${counter}`, pushName: name });
}

test.describe("Ajustes 5 — avisos de mensagem nova", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    await ingestText(request, { jid: JID_ACTIVE, text: "Primeira", pushName: "Cliente Ativo" });
    paused = await ingestText(request, { jid: JID_PAUSED, text: "Primeira", pushName: "Cliente Pausado" });
    disabled = await ingestText(request, { jid: JID_DISABLED, text: "Primeira", pushName: "Cliente Desativado" });
    runLocalSql(`update public.conversations set sla_mode = 'paused', sla_paused_at = now() where id = '${paused}';`);
    runLocalSql(`update public.conversations set sla_mode = 'disabled' where id = '${disabled}';`);
  });

  test("aquecimento", async ({ page }) => {
    test.setTimeout(240_000);
    await prepare(page);
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await page.goto("/conversas");
  });

  test("painel de diagnóstico e 'Testar aviso agora': título, som e aviso do sistema, sem depender de preferências", async ({ page }) => {
    test.setTimeout(120_000);
    await prepare(page);
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await waitConnected(page);
    await expect(page.getByTestId("diag-permission")).toHaveText("concedida");
    await expect(page.getByTestId("diag-audio")).toContainText("bloqueado");
    await expect(page.getByTestId("diag-last-event")).toHaveText("nenhum ainda");
    await expect(page.getByTestId("diag-last-ignored")).toHaveText("nenhum ainda");

    await page.getByTestId("notif-test").click();
    await expect(page.getByTestId("notif-test-result")).toContainText("título ok; som ok; aviso do sistema ok", { timeout: 10_000 });
    // O toque destravou o áudio.
    await expect(page.getByTestId("diag-audio")).toHaveText("liberado");
    // O contador aparece no título por alguns segundos, mesmo com a aba em foco, e volta ao normal.
    await expect.poll(() => page.title(), { timeout: 3_000 }).toMatch(/^\(1\) /);
    expect(await notifs(page)).toBe(1);
    await expect.poll(() => page.title(), { timeout: 12_000 }).not.toMatch(/^\(\d/);
  });

  test("CAUSA RAIZ: prazo pausado avisa; desativado fica em silêncio e o painel explica; ao pedir, avisa", async ({ page, request }) => {
    test.setTimeout(180_000);
    await prepare(page);
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await waitConnected(page);
    await setFocused(page, false);

    await say(request, JID_PAUSED, "Cliente Pausado");
    await expect.poll(() => page.title(), { timeout: 20_000 }).toMatch(/^\(1\) /);
    await expect(page.getByTestId("diag-last-notified")).not.toHaveText("nenhum ainda");
    await expect(page.getByTestId("diag-last-event")).not.toHaveText("nenhum ainda");

    await say(request, JID_DISABLED, "Cliente Desativado");
    await expect(page.getByTestId("diag-last-ignored")).toContainText("prazo desativado", { timeout: 20_000 });
    expect(await page.title()).toMatch(/^\(1\) /);

    // Mensagem enviada por nós (celular) também é explicada.
    await ingestText(request, { jid: JID_ACTIVE, text: "Respondi pelo celular", fromMe: true, pushName: "Cliente Ativo" });
    await expect(page.getByTestId("diag-last-ignored")).toContainText("enviada por você ou pela equipe", { timeout: 20_000 });

    // Pedindo para avisar também o prazo desativado, ele passa a avisar.
    await page.getByTestId("notif-include-disabled").check();
    await say(request, JID_DISABLED, "Cliente Desativado");
    await expect.poll(() => page.title(), { timeout: 20_000 }).toMatch(/^\(2\) /);

    // O painel nunca mostra texto de mensagem.
    expect(await page.getByTestId("notification-diagnostics").innerText()).not.toContain("Mensagem de teste");
  });

  test("permissão do navegador NEGADA: o número no título e o som continuam funcionando", async ({ page, request }) => {
    test.setTimeout(180_000);
    await prepare(page, { permission: "denied" });
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await page.getByTestId("notif-sound").check();
    await waitConnected(page);
    await expect(page.getByTestId("diag-permission")).toHaveText("negada");
    await page.getByTestId("notif-test").click(); // gesto: destrava o áudio
    await expect(page.getByTestId("notif-test-result")).toContainText("título ok; som ok; aviso do sistema sem permissão do navegador", { timeout: 10_000 });
    await expect.poll(() => page.title(), { timeout: 12_000 }).not.toMatch(/^\(\d/);
    await setFocused(page, false);

    await say(request, JID_ACTIVE, "Cliente Ativo");
    await expect.poll(() => page.title(), { timeout: 20_000 }).toMatch(/^\(1\) /);
    expect(await notifs(page)).toBe(0);
    const events = await page.evaluate(() => (window as unknown as { __events: Array<{ sound: boolean; desktop: boolean }> }).__events);
    expect(events.at(-1)).toMatchObject({ sound: true, desktop: false });
  });

  test("Android: o aviso do sistema sai pelo service worker (não por new Notification) e o toque reabre a conversa", async ({ page, request }) => {
    test.setTimeout(180_000);
    await prepare(page, { serviceWorker: true });
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await page.getByTestId("notif-desktop").check();
    await waitConnected(page);
    // O worker mínimo está registrado e ativo.
    await expect
      .poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration("/"))?.active)), { timeout: 20_000 })
      .toBe(true);
    const script = await page.request.get("/sw-avisos.js");
    expect(script.status()).toBe(200);
    expect(await script.text()).toContain("notificationclick");

    await setFocused(page, false);
    await say(request, JID_ACTIVE, "Cliente Ativo");
    await expect.poll(async () => (await shown(page)).length, { timeout: 20_000 }).toBe(1);
    const [first] = await shown(page);
    expect(first.title).toBe("Cliente Ativo");
    expect(first.data.path).toMatch(/^\/conversas\/[0-9a-f-]{36}$/);
    expect(await notifs(page)).toBe(0);
    // O toque no aviso faz o worker mandar a página abrir a conversa (simulamos a mensagem do worker).
    await page.evaluate((path) => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "imobflux:open-conversation", path } }));
    }, first.data.path);
    await expect(page).toHaveURL(new RegExp(first.data.path));
  });

  test("o guia por aparelho aparece em Preferências e, no iPhone no navegador, pede para instalar na tela inicial", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    const guide = page.getByTestId("notif-device-guide");
    await expect(guide).toBeVisible();
    await expect(page.getByTestId("notif-device-summary")).toContainText("instalar o ImobFlux na tela inicial");
    await expect(guide.locator("li")).toHaveCount(3);
    await expect(guide.locator('li[data-current="true"]')).toContainText("iPhone");
    await expect(guide).toContainText("Web Push");
    await context.close();
  });
});
