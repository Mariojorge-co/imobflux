import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Responder com o duplo clique (mouse) e deslizando (toque) + foco direto no campo de mensagem ao responder.

const FAKE_PORT = 3099;
const JID = "5582988884501@s.whatsapp.net";
const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n% teste\n"), Buffer.alloc(2000, 0x20)]);

let fake: FakeEvolution;
let conversation = "";

const history = (page: Page) => page.getByLabel("Histórico de mensagens");
const row = (page: Page, text: string) => history(page).locator("[data-message-id]").filter({ hasText: text }).first();
const box = (page: Page) => page.getByLabel("Digitar mensagem de texto");

async function open(page: Page) {
  await page.goto(`/conversas/${conversation}`);
  await expect(box(page)).toBeVisible();
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

const selectionText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");
const focusedIsComposer = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Digitar mensagem de texto");

test.describe.configure({ mode: "serial" });

test.describe("Responder: duplo clique, deslizar e foco", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Mensagem do cliente para responder", pushName: "Cliente Gesto" });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(async ({ page }) => {
    fake.reset();
    await loginAsDemoOwner(page);
  });

  test("aquecimento", async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
  });

  test("duplo clique na bolha abre a citação, limpa a seleção, põe o cursor no campo e Enter envia com a citação", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await row(page, "Mensagem do cliente para responder").getByTestId("message-bubble").dblclick({ position: { x: 30, y: 12 } });
    await expect(page.getByTestId("reply-card")).toContainText("Mensagem do cliente para responder");
    expect(await selectionText(page)).toBe("");
    await expect.poll(() => focusedIsComposer(page)).toBe(true);
    // pronto para digitar, sem clicar
    await page.keyboard.type("Resposta pelo duplo clique");
    await expect(box(page)).toHaveValue("Resposta pelo duplo clique");
    await page.keyboard.press("Enter");
    await expect.poll(() => fake.requests.filter((r) => r.path.includes("/message/sendText/")).length).toBe(1);
    const sent = fake.requests.find((r) => r.path.includes("/message/sendText/"))!;
    expect(sent.body.quoted).toMatchObject({ key: { remoteJid: JID } });
    await expect(row(page, "Resposta pelo duplo clique").getByTestId("reply-quote")).toContainText("Mensagem do cliente para responder");
  });

  test("selecionar texto arrastando continua funcionando (só o duplo clique rápido vira resposta)", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    const bubble = row(page, "Mensagem do cliente para responder").getByTestId("message-bubble");
    const area = await bubble.boundingBox();
    await page.mouse.move(area!.x + 6, area!.y + 12);
    await page.mouse.down();
    await page.mouse.move(area!.x + area!.width - 10, area!.y + 12, { steps: 8 });
    await page.mouse.up();
    expect((await selectionText(page)).length).toBeGreaterThan(3);
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
  });

  test("o menu Responder também leva o cursor direto ao campo; rascunho é mantido com o cursor no fim", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await box(page).fill("rascunho que fica");
    await page.getByRole("heading").first().click();
    const target = row(page, "Mensagem do cliente para responder");
    await target.hover();
    await target.getByTestId("message-menu-button").click();
    await page.getByTestId("action-reply").click();
    await expect(page.getByTestId("reply-card")).toBeVisible();
    await expect.poll(() => focusedIsComposer(page)).toBe(true);
    await expect(box(page)).toHaveValue("rascunho que fica");
    const caret = await box(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.value.length]);
    expect(caret).toEqual([17, 17, 17]);
    await page.keyboard.type("!");
    await expect(box(page)).toHaveValue("rascunho que fica!");
    await box(page).fill("");
    await box(page).press("Escape");
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
  });

  test("na aba Nota interna, responder volta para a aba Mensagem", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await page.getByRole("button", { name: "Nota interna" }).click();
    await expect(page.getByLabel("Digitar nota interna (apenas CRM)")).toBeVisible();
    await row(page, "Mensagem do cliente para responder").getByTestId("message-bubble").dblclick({ position: { x: 30, y: 12 } });
    await expect(page.getByTestId("reply-card")).toBeVisible();
    await expect(box(page)).toBeVisible();
    await expect.poll(() => focusedIsComposer(page)).toBe(true);
  });

  test("não dispara em botão, mídia/anexo, mensagem apagada, durante a edição nem em nota interna", async ({ page, request }) => {
    test.setTimeout(180_000);
    await open(page);
    // botão (menu da mensagem) e reação
    const target = row(page, "Mensagem do cliente para responder");
    await target.hover();
    await target.getByTestId("message-menu-button").dblclick();
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // anexo (cartão do documento): duplo clique nele não responde
    await page.getByTestId("file-input").setInputFiles([{ name: "contrato.pdf", mimeType: "application/pdf", buffer: pdf }]);
    await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(1, { timeout: 60_000 });
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    const withFile = history(page).locator("[data-message-id]").filter({ hasText: "contrato.pdf" }).first();
    await expect(withFile).toBeVisible({ timeout: 30_000 });
    await expect(withFile.locator("[data-no-reply]").first()).toBeVisible();
    await withFile.locator("[data-no-reply]").first().dblclick();
    await expect(page.getByTestId("reply-card")).toHaveCount(0);

    // durante a edição de uma mensagem nossa
    await box(page).fill("Mensagem que vou editar");
    await page.keyboard.press("Enter");
    await expect(row(page, "Mensagem que vou editar")).toBeVisible();
    await expect(history(page).getByTestId("message-sending")).toHaveCount(0, { timeout: 20_000 });
    const mine = row(page, "Mensagem que vou editar");
    await mine.hover();
    await mine.getByTestId("message-menu-button").click();
    await page.getByTestId("action-edit").click();
    await expect(box(page)).toHaveValue("Mensagem que vou editar");
    await row(page, "Mensagem do cliente para responder").getByTestId("message-bubble").dblclick({ position: { x: 30, y: 12 } });
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
    await box(page).press("Escape");
    // a citação não ficou "escondida" por trás da edição: ao sair dela, continua sem resposta
    await expect(page.getByTestId("reply-card")).toHaveCount(0);

    // mensagem apagada
    await mine.hover();
    await mine.getByTestId("message-menu-button").click();
    await page.getByTestId("action-delete-all").click();
    await page.locator("dialog[open]").getByRole("button", { name: "Apagar para todos" }).click();
    await expect(page.getByTestId("message-deleted")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("message-deleted").dblclick();
    await expect(page.getByTestId("reply-card")).toHaveCount(0);

    // nota interna: não tem resposta
    await page.getByRole("button", { name: "Nota interna" }).click();
    await page.getByLabel("Digitar nota interna (apenas CRM)").fill("Nota sem resposta");
    await page.keyboard.press("Enter");
    const note = page.getByTestId("internal-note").filter({ hasText: "Nota sem resposta" });
    await expect(note).toBeVisible();
    await note.getByTestId("note-text").dblclick();
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
    void request;
  });

  test("celular: deslizar a bolha para a direita responde; rolar na vertical não", async ({ browser }) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await open(page);
    const bubble = row(page, "Mensagem do cliente para responder").getByTestId("message-bubble");
    await bubble.scrollIntoViewIfNeeded();
    const area = (await bubble.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const touch = async (type: string, x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    const y = area.y + area.height / 2;
    const x0 = area.x + 20;

    // vertical: nada
    await touch("touchStart", x0, y);
    for (let i = 1; i <= 6; i += 1) await touch("touchMove", x0 + 2, y + i * 12);
    await touch("touchEnd", x0, y + 72);
    await expect(page.getByTestId("reply-card")).toHaveCount(0);

    // horizontal para a direita: responde, com o ícone aparecendo no caminho
    await touch("touchStart", x0, y);
    for (let i = 1; i <= 7; i += 1) await touch("touchMove", x0 + i * 10, y + 1);
    await expect(page.getByTestId("swipe-reply-icon")).toBeVisible();
    await touch("touchEnd", x0 + 70, y + 1);
    await expect(page.getByTestId("reply-card")).toContainText("Mensagem do cliente para responder");
    await expect.poll(() => focusedIsComposer(page)).toBe(true);
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.inner);
    await context.close();
  });
});
