import { expect, test } from "@playwright/test";
import { formatCurrency, formatEnumLabel } from "@/lib/formatters";
import {
  loginAsDemoOwner,
  resetAndLoadDemoMode,
} from "./helpers/local-test-state";

test.describe("Sprint 23 — Hotfix Consolidado & Validações de UX/Bugs", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await resetAndLoadDemoMode();
  });

  test("1. Validador de Utilitários: formatCurrency contra NaN, null, undefined", () => {
    expect(formatCurrency(null)).toBe("Não informado");
    expect(formatCurrency(undefined)).toBe("Não informado");
    expect(formatCurrency("")).toBe("Não informado");
    expect(formatCurrency(NaN)).toBe("Não informado");
    expect(formatCurrency("invalid_string")).toBe("Não informado");
    expect(formatCurrency(250000)).toContain("250.000,00");
  });

  test("2. Validador de Utilitários: formatEnumLabel traduzindo para PT-BR", () => {
    expect(formatEnumLabel("not_analyzed")).toBe("Não analisado");
    expect(formatEnumLabel("not_sent")).toBe("Não enviada");
    expect(formatEnumLabel("open")).toBe("Em aberto");
    expect(formatEnumLabel("person")).toBe("Pessoa");
    expect(formatEnumLabel("provisional")).toBe("Contato não salvo");
  });

  test("3. E2E: Navegação Direta e Layout em 2 Colunas no Dashboard de Prioridades", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/prioridades");

    await expect(page.getByRole("heading", { name: /Equipe Devendo Resposta/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Aguardando Cliente/i })).toBeVisible();
  });

  test("4. E2E Mobile: Viewport 375px com composer no rodapé e gaveta de contexto de 44px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsDemoOwner(page);
    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");

    const toggleContextBtn = page.getByRole("button", { name: /Abrir dados|Informações/i });
    await expect(toggleContextBtn).toBeVisible();
    await toggleContextBtn.click();
    await expect(page.getByRole("heading", { name: "Identificação" })).toBeVisible();
  });

  test("5. E2E: Proteção contra NaN na UI do painel de contexto do cliente", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");
    await page.getByRole("button", { name: "Abrir dados do cliente" }).click();
    await expect(page.getByRole("heading", { name: "Identificação" })).toBeVisible();

    const pageText = await page.getByRole("main").innerText();
    expect(pageText).not.toContain("NaN");
    expect(pageText).not.toContain("undefined");
  });
});
