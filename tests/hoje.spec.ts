import { expect, test } from "@playwright/test";
import { loginAsDemoAttendant, loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { expandSection } from "./helpers/hoje";
import { ingestText } from "./helpers/webhook";

// Painel "Hoje": cliente esperando e conversa nova sem atendimento aparecem, o clique abre a conversa, o proprietário
// filtra por responsável, o atendente não vê o filtro, e o celular não rola para o lado.

const JID = "5582988880303@s.whatsapp.net";
let conversation = "";

test.describe("Painel Hoje", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    conversation = await ingestText(request, { jid: JID, text: "Oi, quero saber do imóvel", pushName: "Cliente Hoje" });
  });

  test("aquecimento", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await page.waitForLoadState("domcontentloaded");
  });

  test("o proprietário vê o cliente esperando, a conversa nova e abre a conversa pelo clique", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    await expandSection(page, "hoje-waiting");
    await expandSection(page, "hoje-new");
    const waiting = page.getByTestId("hoje-waiting");
    await expect(waiting.getByTestId("hoje-conversation").filter({ hasText: "Cliente Hoje" })).toBeVisible();
    await expect(waiting).toContainText("Cliente aguardando há");
    await expect(page.getByTestId("hoje-new").getByTestId("hoje-new-item").filter({ hasText: "Cliente Hoje" })).toBeVisible();
    // O demo traz mensagens de "algumas horas atrás": perto da meia-noite elas contam como "hoje". Basta o contador incluir a nova (>= 1).
    await expect.poll(async () => Number(((await page.getByTestId("hoje-counter-incoming").innerText()).match(/[0-9]+/) ?? ["0"])[0])).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("hoje-filter")).toBeVisible();
    await page.getByTestId("hoje-conversation").filter({ hasText: "Cliente Hoje" }).click();
    await expect(page).toHaveURL(new RegExp(`/conversas/${conversation}`));
  });

  test("filtro 'Sem responsável' mantém a conversa; filtrar por um membro a esconde", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje?atendente=sem-responsavel");
    await expandSection(page, "hoje-waiting");
    await expect(page.getByTestId("hoje-waiting").filter({ hasText: "Cliente Hoje" })).toBeVisible();
    await page.goto("/hoje?atendente=00000000-0000-4000-8000-000000000000");
    await expect(page.getByTestId("hoje-waiting")).toContainText("Nenhum cliente esperando resposta.");
  });

  test("o atendente não vê o filtro da equipe nem conversas de outros", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoAttendant(page);
    await page.goto("/hoje?atendente=sem-responsavel");
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    await expect(page.getByTestId("hoje-filter")).toHaveCount(0);
    await expect(page.getByTestId("hoje-waiting")).toContainText("Nenhum cliente esperando resposta.");
  });

  test("celular: sem rolagem horizontal", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await expect(page.getByTestId("hoje-counters")).toBeVisible();
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.inner);
    await context.close();
  });
});
