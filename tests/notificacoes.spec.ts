import { expect, test, type Page } from "@playwright/test";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Avisos de mensagem nova: contador no título só com a aba fora de foco, aviso do sistema (simulado) com e sem prévia, som,
// clique no aviso abre a conversa, mensagem enviada por nós não conta, e as escolhas ficam salvas por pessoa.

const JID_A = "5582988880401@s.whatsapp.net";
const JID_B = "5582988880402@s.whatsapp.net";
const JID_C = "5582988880403@s.whatsapp.net";

async function prepare(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__focused = true;
    w.__notifs = [];
    w.__events = [];
    document.hasFocus = () => w.__focused === true;
    class FakeNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick: (() => void) | null = null;
      constructor(public title: string, public options: { body?: string } = {}) {
        (w.__notifs as unknown[]).push(this);
      }
      close() {}
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
    window.addEventListener("imobflux:notified", (event) => (w.__events as unknown[]).push((event as CustomEvent).detail));
  });
}

async function setFocused(page: Page, focused: boolean) {
  await page.evaluate((value) => {
    (window as unknown as Record<string, unknown>).__focused = value;
    if (value) window.dispatchEvent(new Event("focus"));
  }, focused);
}

const notifs = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __notifs: Array<{ title: string; options: { body?: string } }> }).__notifs.map((n) => ({
      title: n.title,
      body: n.options.body,
    })),
  );
const events = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __events: Array<{ sound: boolean; desktop: boolean; conversationId: string }> }).__events,
  );

async function waitInboxReady(page: Page) {
  await expect(page.locator("html[data-realtime-inbox='ready']")).toBeAttached({ timeout: 30_000 });
  await page.waitForTimeout(1500);
}

async function enablePrefs(page: Page, hidePreview: boolean) {
  await page.goto("/preferencias");
  await page.getByTestId("notif-sound").check();
  await page.getByTestId("notif-desktop").check();
  if (hidePreview) await page.getByTestId("notif-hide-preview").check();
}

test.describe("Avisos de mensagem nova", () => {
  let conversationA = "";

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    conversationA = await ingestText(request, { jid: JID_A, text: "Primeira", pushName: "Cliente Aviso A" });
    await ingestText(request, { jid: JID_B, text: "Primeira", pushName: "Cliente Aviso B" });
  });

  test("aquecimento", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDemoOwner(page);
    for (const route of ["/preferencias", "/conversas", `/conversas/${conversationA}`]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
    }
  });

  test("as escolhas ficam salvas, são pessoais e começam desligadas", async ({ page }) => {
    test.setTimeout(120_000);
    await prepare(page);
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await expect(page.getByTestId("notif-sound")).not.toBeChecked();
    await expect(page.getByTestId("notif-desktop")).not.toBeChecked();
    await page.getByTestId("notif-sound").check();
    await page.getByTestId("notif-desktop").check();
    await page.getByTestId("notif-hide-preview").check();
    await page.reload();
    await expect(page.getByTestId("notif-sound")).toBeChecked();
    await expect(page.getByTestId("notif-desktop")).toBeChecked();
    await expect(page.getByTestId("notif-hide-preview")).toBeChecked();
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("imobflux:notificacoes:")));
    expect(keys).toHaveLength(1);
    await page.getByTestId("notif-hide-preview").uncheck();
  });

  test("aba fora de foco: título conta, som e aviso do sistema saem, clique abre a conversa, foco zera", async ({ page, request }) => {
    test.setTimeout(180_000);
    await prepare(page);
    await loginAsDemoOwner(page);
    await enablePrefs(page, false);
    await page.goto("/conversas");
    await waitInboxReady(page);
    await setFocused(page, false);

    await ingestText(request, { jid: JID_B, text: "Quero visitar o imóvel amanhã", pushName: "Cliente Aviso B" });
    await expect.poll(() => page.title(), { timeout: 20_000 }).toMatch(/^\(1\) /);
    await expect.poll(async () => (await notifs(page)).length).toBe(1);
    const [first] = await notifs(page);
    expect(first.title).toBe("Cliente Aviso B");
    expect(first.body).toContain("Quero visitar");
    expect((await events(page))[0]).toMatchObject({ sound: true, desktop: true });

    // enviada por nós (celular): não conta
    await ingestText(request, { jid: JID_B, text: "Respondi pelo celular", fromMe: true, pushName: "Cliente Aviso B" });
    await page.waitForTimeout(2500);
    expect(await page.title()).toMatch(/^\(1\) /);

    await ingestText(request, { jid: JID_A, text: "Outra pessoa escreveu", pushName: "Cliente Aviso A" });
    await expect.poll(() => page.title(), { timeout: 20_000 }).toMatch(/^\(2\) /);

    await page.evaluate(() => (window as unknown as { __notifs: Array<{ onclick: () => void }> }).__notifs[0].onclick());
    await expect(page).toHaveURL(/\/conversas\//);

    await setFocused(page, true);
    await expect.poll(() => page.title()).not.toMatch(/^\(\d/);
  });

  test("com a prévia escondida o aviso do sistema não mostra nome nem texto", async ({ page, request }) => {
    test.setTimeout(180_000);
    await prepare(page);
    await loginAsDemoOwner(page);
    await enablePrefs(page, true);
    await page.goto("/conversas");
    await waitInboxReady(page);
    await setFocused(page, false);
    await ingestText(request, { jid: JID_C, text: "Texto secreto da mensagem", pushName: "Cliente Sigiloso" });
    await expect.poll(async () => (await notifs(page)).length, { timeout: 20_000 }).toBe(1);
    const [only] = await notifs(page);
    expect(JSON.stringify(only)).not.toContain("Sigiloso");
    expect(JSON.stringify(only)).not.toContain("secreto");
  });

  test("aba em foco e conversa aberta: nada de contador nem aviso; em foco em outra tela: só o som", async ({ page, request }) => {
    test.setTimeout(180_000);
    await prepare(page);
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${conversationA}`);
    await waitInboxReady(page);
    await ingestText(request, { jid: JID_A, text: "Mensagem na conversa aberta", pushName: "Cliente Aviso A" });
    await page.waitForTimeout(3000);
    expect(await events(page)).toHaveLength(0);
    expect(await notifs(page)).toHaveLength(0);
    expect(await page.title()).not.toMatch(/^\(\d/);

    await ingestText(request, { jid: JID_B, text: "Mensagem em outra conversa", pushName: "Cliente Aviso B" });
    await expect.poll(async () => (await events(page)).length, { timeout: 20_000 }).toBe(1);
    expect(await notifs(page)).toHaveLength(0);
    expect(await page.title()).not.toMatch(/^\(\d/);
  });
});
