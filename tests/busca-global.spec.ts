import { expect, test, type Page } from "@playwright/test";
import { loginAsDemoAttendant, loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode, runLocalSql } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Busca global: acha mensagens e contatos de várias conversas, destaca o termo, abre a conversa NA mensagem achada (mesmo uma
// antiga, que ainda não estava carregada), pagina, respeita contato protegido para o atendente e não vaza HTML.

const JID_A = "5582988880701@s.whatsapp.net";
const JID_B = "5582988880702@s.whatsapp.net";
const JID_P = "5582988880703@s.whatsapp.net";
let conversationA = "";

async function openSearch(page: Page) {
  await page.getByTestId("global-search-button").click();
  await expect(page.getByTestId("global-search-input")).toBeFocused();
}

test.describe("Busca global", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await resetAndLoadDemoMode();
    conversationA = await ingestText(request, { jid: JID_A, text: "Palavra rarissima zebrafish no começo", pushName: "Cliente Busca A" });
    // muitas mensagens depois, para a primeira ficar fora da página carregada
    for (let i = 0; i < 70; i += 1) {
      await ingestText(request, { jid: JID_A, text: `Mensagem de enchimento número ${i}`, pushName: "Cliente Busca A", id: `fill-${i}` });
    }
    await ingestText(request, { jid: JID_B, text: "Quero financiamento <b>negrito</b> do apartamento", pushName: "Cliente Busca B" });
    await ingestText(request, { jid: JID_P, text: "Financiamento do contato protegido", pushName: "Cliente Sigiloso" });
    runLocalSql(
      "update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null where id in (select p.contact_id from public.contact_points p where p.normalized_value = '+5582988880703');" +
        "update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988880703';",
    );
  });

  test("aquecimento", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDemoOwner(page);
    await page.goto("/conversas");
    await page.goto(`/conversas/${conversationA}`);
  });

  test("acha pelo texto, destaca o termo e mostra o conteúdo como texto (sem HTML)", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await openSearch(page);
    await page.getByTestId("global-search-input").fill("financiamento");
    const results = page.getByTestId("global-search-result");
    await expect(results.first()).toBeVisible({ timeout: 30_000 });
    await expect(results.filter({ hasText: "Cliente Busca B" })).toHaveCount(1);
    await expect(results.filter({ hasText: "Cliente Sigiloso" })).toHaveCount(1); // o dono vê o protegido
    await expect(results.first().getByTestId("search-mark").first()).toContainText(/financiamento/i);
    // marcação digitada na mensagem aparece como texto, não vira elemento
    await page.getByTestId("global-search-input").fill("negrito");
    await expect(results.filter({ hasText: "<b>negrito</b>" })).toHaveCount(1);
    await expect(page.locator("dialog[open] b")).toHaveCount(0);
  });

  test("abre a conversa na mensagem ANTIGA achada e a destaca", async ({ page }) => {
    test.setTimeout(180_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await openSearch(page);
    await page.getByTestId("global-search-input").fill("zebrafish");
    const hit = page.getByTestId("global-search-result").filter({ hasText: "zebrafish" });
    await expect(hit).toHaveCount(1, { timeout: 30_000 });
    await hit.click();
    await expect(page).toHaveURL(new RegExp(`/conversas/${conversationA}\\?msg=`));
    const messageId = queryLocalSql("select id from public.messages where text_content like '%zebrafish%';");
    const target = page.locator(`[data-message-id="${messageId}"]`);
    await expect(target).toBeVisible({ timeout: 60_000 });
    await expect(target).toBeInViewport();
  });

  test("contato por nome e por telefone; termo curto não busca; Esc fecha", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await openSearch(page);
    await page.getByTestId("global-search-input").fill("a");
    await expect(page.getByTestId("global-search-status")).toContainText("ao menos 2 letras");
    await page.getByTestId("global-search-input").fill("Busca B");
    await expect(page.getByTestId("global-search-result").filter({ hasText: "Cliente Busca B" }).first()).toHaveAttribute("data-kind", "contact", { timeout: 30_000 });
    await page.getByTestId("global-search-input").fill("88880702");
    await expect(page.getByTestId("global-search-result").filter({ hasText: "Cliente Busca B" })).toHaveCount(1, { timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("paginação: 'Mostrar mais' traz o restante", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await openSearch(page);
    await page.getByTestId("global-search-input").fill("enchimento");
    await expect(page.getByTestId("global-search-result")).toHaveCount(20, { timeout: 30_000 });
    await page.getByTestId("global-search-more").click();
    await expect(page.getByTestId("global-search-result")).toHaveCount(40, { timeout: 30_000 });
  });

  test("tecla / abre a busca fora dos campos, mas não dentro da caixa de mensagem", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await page.keyboard.press("/");
    await expect(page.getByTestId("global-search-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.goto(`/conversas/${conversationA}`);
    const box = page.getByLabel("Digitar mensagem de texto");
    await box.click();
    await page.keyboard.type("a/b");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("atendente não acha o contato protegido", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoAttendant(page);
    await page.goto("/hoje");
    await openSearch(page);
    await page.getByTestId("global-search-input").fill("financiamento");
    await expect(page.getByTestId("global-search-result").filter({ hasText: "Cliente Busca B" })).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("global-search-result").filter({ hasText: "Cliente Sigiloso" })).toHaveCount(0);
  });

  test("celular: a busca cabe na tela e o botão tem 44px", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    const box = await page.getByTestId("global-search-button").boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    await openSearch(page);
    await page.getByTestId("global-search-input").fill("financiamento");
    await expect(page.getByTestId("global-search-result").first()).toBeVisible({ timeout: 30_000 });
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.inner);
    await context.close();
  });
});
