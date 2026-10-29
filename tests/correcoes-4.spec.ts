import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { activeInstance, ingestText, postWebhook } from "./helpers/webhook";
import { queryLocalSql } from "./helpers/local-test-state";

// Correções 4: botão Sair no celular (dentro do menu, com confirmação) e duplo clique na linha inteira da mensagem.

const FAKE_PORT = 3099;
const JID = "5582988884502@s.whatsapp.net";
let fake: FakeEvolution;
let conversation = "";

const MIB = 1024 * 1024;
const MEDIA_JID = "5582988884503@s.whatsapp.net";
let mediaConversation = "";

async function postMedia(request: import("@playwright/test").APIRequestContext, id: string, content: Record<string, unknown>, base64?: string) {
  const response = await postWebhook(request, {
    event: "messages.upsert",
    instance: activeInstance(),
    data: {
      key: { remoteJid: MEDIA_JID, fromMe: false, id },
      pushName: "Cliente Mídia",
      message: content,
      ...(base64 ? { base64 } : {}),
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  });
  expect(response.ok()).toBe(true);
}
const attachmentStatus = (id: string) =>
  queryLocalSql(`select a.status from public.attachments a join public.messages m on m.id = a.message_id where m.external_message_id = '${id}';`);

const history = (page: Page) => page.getByLabel("Histórico de mensagens");
const row = (page: Page, text: string) => history(page).locator("[data-message-id]").filter({ hasText: text }).first();
const box = (page: Page) => page.getByLabel("Digitar mensagem de texto");

async function open(page: Page) {
  await page.goto(`/conversas/${conversation}`);
  await expect(box(page)).toBeVisible();
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("Correções 4", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Mensagem do cliente linha inteira", pushName: "Cliente Linha" });
  });
  test.afterAll(async () => { await fake?.close(); });
  test.beforeEach(async ({ page }) => { fake.reset(); await loginAsDemoOwner(page); });

  test("vídeo acima do limite: aviso final claro (tamanho e limite), sem \"Carregando\"/\"Tentando\" eterno; tentar de novo explica e volta", async ({ page, request }) => {
    test.setTimeout(240_000);
    await postMedia(request, "BIG-VIDEO-1", { videoMessage: { mimetype: "video/mp4", fileLength: 60 * MIB } });
    mediaConversation = queryLocalSql(`select id from public.conversations where external_thread_id = '${MEDIA_JID}' limit 1;`);
    expect(attachmentStatus("BIG-VIDEO-1")).toBe("unavailable");
    await page.goto(`/conversas/${mediaConversation}`);
    const card = page.getByTestId("attachment-unavailable");
    await expect(card).toContainText("Vídeo · 60,0 MB");
    await expect(card).not.toContainText("Vídeo · video");
    await expect(card).toContainText("Arquivo grande demais para o ImobFlux (60,0 MB; limite 50 MB). Abra no WhatsApp.");
    await expect(page.getByText("Carregando arquivo…")).toHaveCount(0);
    await card.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(card.getByRole("alert")).toContainText("limite de 50 MB");
    await expect(card.getByRole("button", { name: "Tentar de novo" })).toBeEnabled();
  });

  test("vídeo dentro do limite (acima de 25 MB antigos) é guardado e carrega", async ({ page, request }) => {
    test.setTimeout(120_000);
    const bytes = Buffer.alloc(26 * MIB, 0x41);
    fake.behavior.media = () => ({ base64: bytes.toString("base64"), mimetype: "video/mp4" });
    await postMedia(request, "OK-VIDEO-1", { videoMessage: { mimetype: "video/mp4", fileLength: bytes.length } });
    await expect.poll(() => attachmentStatus("OK-VIDEO-1"), { timeout: 60_000 }).toBe("available");
    // os bytes de teste não são um vídeo de verdade (o player não os decodifica): o que importa é o arquivo de 26 MB guardado e servido inteiro
    const id = queryLocalSql(`select a.id from public.attachments a join public.messages m on m.id = a.message_id where m.external_message_id = 'OK-VIDEO-1';`);
    expect(queryLocalSql(`select size_bytes from public.attachments where id = '${id}';`)).toBe(String(bytes.length));
    await page.goto(`/conversas/${mediaConversation}`);
    const served = await page.request.get(`/api/attachments/${id}`);
    expect(served.status()).toBe(200);
    expect((await served.body()).length).toBe(bytes.length);
  });

  test("arquivo que a Evolution não tem mais: tentar de novo termina com o motivo, sem ficar \"Tentando…\"", async ({ page, request }) => {
    test.setTimeout(120_000);
    await postMedia(request, "GONE-DOC-1", { documentMessage: { mimetype: "application/pdf", fileName: "sumiu.pdf", fileLength: 2000 } });
    await expect.poll(() => attachmentStatus("GONE-DOC-1"), { timeout: 60_000 }).toBe("unavailable");
    await page.goto(`/conversas/${mediaConversation}`);
    const card = page.getByTestId("attachment-unavailable").filter({ hasText: "sumiu.pdf" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(card.getByRole("alert")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("button", { name: "Tentar de novo" })).toBeEnabled();
  });

  test("aquecimento", async ({ page }) => { test.setTimeout(240_000); await open(page); });

  test("celular 390x844: Sair não fica na barra ao lado do sanduíche; no menu pede confirmação", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    const bar = page.getByRole("banner", { name: "Barra superior" });
    await expect(bar.getByRole("button", { name: "Abrir menu principal" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Sair" })).toHaveCount(0);
    const menuButton = (await bar.getByRole("button", { name: "Abrir menu principal" }).boundingBox())!;
    expect(menuButton.width).toBeGreaterThanOrEqual(44);
    expect(menuButton.height).toBeGreaterThanOrEqual(44);
    await bar.getByRole("button", { name: "Abrir menu principal" }).click();
    const logout = page.getByTestId("logout-menu-button");
    await expect(logout).toBeVisible();
    expect((await logout.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // o Sair do menu fica longe do sanduíche (nunca vizinho dele)
    expect((await logout.boundingBox())!.y).toBeGreaterThan(menuButton.y + menuButton.height + 16);
    await logout.click();
    const dialog = page.getByRole("alertdialog", { name: "Sair do ImobFlux?" });
    await expect(dialog).toBeVisible();
    const cancel = (await dialog.getByRole("button", { name: "Cancelar" }).boundingBox())!;
    const confirm = (await dialog.getByRole("button", { name: "Sair" }).boundingBox())!;
    expect(cancel.height).toBeGreaterThanOrEqual(44);
    expect(confirm.height).toBeGreaterThanOrEqual(44);
    expect(confirm.x - (cancel.x + cancel.width)).toBeGreaterThanOrEqual(16);
    // cancelar mantém a sessão
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/hoje$/);
    // confirmar sai
    await logout.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("desktop: Sair continua na barra, sem confirmação", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/hoje");
    await page.getByRole("banner", { name: "Barra superior" }).getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("duplo clique ao lado da bolha (linha da mensagem) abre a citação e limpa a seleção", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    const target = row(page, "Mensagem do cliente linha inteira");
    const rowBox = (await target.getByTestId("message-row").boundingBox())!;
    const bubble = (await target.getByTestId("message-bubble").boundingBox())!;
    // mensagem recebida: bolha à esquerda; o vazio fica à direita da bolha
    const emptyX = bubble.x + bubble.width + (rowBox.x + rowBox.width - (bubble.x + bubble.width)) / 2;
    expect(emptyX).toBeGreaterThan(bubble.x + bubble.width + 20);
    await page.mouse.dblclick(emptyX, bubble.y + bubble.height / 2);
    await expect(page.getByTestId("reply-card")).toContainText("Mensagem do cliente linha inteira");
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Digitar mensagem de texto");
  });

  test("arrastar o mouse pela linha continua selecionando; área proibida (botão do menu) não responde", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    const target = row(page, "Mensagem do cliente linha inteira");
    const bubble = (await target.getByTestId("message-bubble").boundingBox())!;
    await page.mouse.move(bubble.x + 6, bubble.y + 12);
    await page.mouse.down();
    await page.mouse.move(bubble.x + bubble.width - 10, bubble.y + 12, { steps: 8 });
    await page.mouse.up();
    expect((await page.evaluate(() => window.getSelection()?.toString() ?? "")).length).toBeGreaterThan(3);
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
    await target.hover();
    await target.getByTestId("message-menu-button").dblclick();
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
  });
});
