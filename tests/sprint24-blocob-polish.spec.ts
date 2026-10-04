import { expect, test } from "@playwright/test";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";

const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "laptop-1366", width: 1366, height: 768 },
  { name: "desktop-1920", width: 1920, height: 1080 },
];

test.describe.serial("Sprint 24 Bloco B — Contatos e Kanban Visual & Responsiveness", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await resetAndLoadDemoMode();
  });

  for (const vp of VIEWPORTS) {
    test(`Contatos em ${vp.name} (${vp.width}x${vp.height}): layout correto e sem overflow no body`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAsDemoOwner(page);

      await page.goto("/contatos");
      await page.waitForLoadState("domcontentloaded");

      // Verifica título da página
      const title = page.locator("h1:visible").filter({ hasText: "Contatos" });
      await expect(title).toContainText("Contatos");

      // Verifica ausência de overflow horizontal global no documento
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll).toBe(false);

      // Verifica campo de busca
      const searchInput = page.getByPlaceholder("Buscar por nome ou telefone...");
      await expect(searchInput).toBeVisible();

      // Verifica botão Novo Contato
      const newContactBtn = page.getByRole("button", { name: /novo contato/i });
      await expect(newContactBtn).toBeVisible();
    });

    test(`Kanban em ${vp.name} (${vp.width}x${vp.height}): layout correto e sem overflow no body`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await loginAsDemoOwner(page);

      await page.goto("/kanban");
      await page.waitForLoadState("domcontentloaded");

      // Verifica título
      const title = page.locator("h1:visible").filter({ hasText: "Kanban Comercial" });
      await expect(title).toContainText("Kanban Comercial");

      // Verifica ausência de overflow horizontal global no documento
      const hasBodyOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasBodyOverflow).toBe(false);

      // Verifica botão Nova Oportunidade
      const newOppBtn = page.getByRole("button", { name: /nova oportunidade/i });
      await expect(newOppBtn).toBeVisible();

      // Verifica container do Kanban
      const boardContainer = page.getByTestId("kanban-board-container");
      await expect(boardContainer).toBeVisible();
    });
  }

  test("Contatos: Diálogo de criação abre e fecha com acessibilidade", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await loginAsDemoOwner(page);

    await page.goto("/contatos");
    await page.waitForLoadState("domcontentloaded");

    const newContactBtn = page.getByRole("button", { name: /novo contato/i });
    await newContactBtn.click();

    // Dialog deve estar visível
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Novo contato")).toBeVisible();

    // Fechar pelo botão cancelar
    const cancelBtn = dialog.getByRole("button", { name: /cancelar/i });
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test("Kanban: Modal de nova oportunidade abre e fecha com acessibilidade", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await loginAsDemoOwner(page);

    await page.goto("/kanban");
    await page.waitForLoadState("domcontentloaded");

    const newOppBtn = page.getByRole("button", { name: /nova oportunidade/i });
    await newOppBtn.click();

    // Dialog deve estar visível
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Nova Oportunidade")).toBeVisible();

    // Fechar pelo botão cancelar
    const cancelBtn = dialog.getByRole("button", { name: /cancelar/i });
    await cancelBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test("Contatos: menu contextual permanece sem ações ambíguas", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await loginAsDemoOwner(page);
    await page.goto("/contatos");

    const table = page.getByRole("table");
    const firstRow = table.getByRole("row").nth(1);
    const actionButton = firstRow.getByRole("button", { name: /ações secundárias para/i });
    await actionButton.click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /arquivar contato/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(actionButton).toBeFocused();
  });

  test("Contatos: menu no topo e no fim da lista respeita a viewport", async ({ page }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
    ]) {
      await page.setViewportSize(viewport);
      await loginAsDemoOwner(page);
      await page.goto("/contatos");

      const triggers = page.getByRole("button", { name: /ações secundárias para/i });
      for (const trigger of [triggers.first(), triggers.last()]) {
        await trigger.click();
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("menuitem").first()).toBeVisible();

        const box = await menu.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

        await page.keyboard.press("Escape");
        await expect(menu).not.toBeVisible();
      }
    }
  });

  test("Kanban: card abre detalhes pelo teclado e controle interno não abre o drawer", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await loginAsDemoOwner(page);
    await page.goto("/kanban");

    const board = page.getByTestId("kanban-board-container");
    const card = board.locator('[data-testid^="kanban-card-"]').first();
    const moveButton = card.getByRole("button", { name: /mover oportunidade/i });
    await moveButton.click();
    await expect(page.getByRole("dialog", { name: "Detalhes da Oportunidade" })).not.toBeVisible();

    await card.getByRole("button").nth(1).press("Enter");
    await expect(page.getByRole("dialog", { name: "Detalhes da Oportunidade" })).toBeVisible();
  });

  test("Conversa arquivada mantém a identidade CRM no cabeçalho", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await loginAsDemoOwner(page);
    await page.goto("/conversas/d3300003-0000-4000-8000-000000000020");

    await expect(
      page.getByRole("main").getByText("Vanessa Cristina Andrade", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Participante desconhecido", { exact: true })).not.toBeVisible();
  });

  test("Contatos: conversa existente usa Abrir conversa e não inicia outra", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await loginAsDemoOwner(page);
    await page.goto("/contatos");

    const table = page.getByRole("table");
    const row = table.getByRole("row").filter({ hasText: "Vanessa Cristina Andrade" });
    await expect(row.getByRole("link", { name: /abrir conversa com vanessa/i })).toBeVisible();
    await expect(row.getByRole("button", { name: /iniciar conversa com vanessa/i })).not.toBeVisible();
  });

  test("Contatos: múltiplos telefones não oferecem edição arbitrária", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await loginAsDemoOwner(page);
    await page.goto("/contatos");

    const row = page.getByRole("row").filter({ hasText: "Múltiplos telefones ativos" }).first();
    if ((await row.count()) === 0) {
      test.skip(true, "O ambiente demo atual não possui contato com múltiplos telefones ativos.");
      return;
    }

    await row.getByRole("button", { name: /ações secundárias para/i }).click();
    await expect(page.getByRole("menu").getByRole("menuitem", { name: /editar contato/i })).not.toBeVisible();
  });
});
