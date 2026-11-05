import { expect, test } from "@playwright/test";
import { auditContrast } from "./helpers/contrast";

// Página 404 em português: status 404, texto fixo, botão de 44 px, sem rolagem lateral e contraste AA nos temas claro e escuro,
// a 360, 390, 430 e no computador. (O error.tsx e o global-error só aparecem em falha real; o código deles é conferido em
// tests/paginas-erro.unit.spec.ts.)

const WIDTHS = [360, 390, 430, 1280];

for (const width of WIDTHS) {
  for (const theme of ["light", "dark"] as const) {
    test(`404 a ${width}px no tema ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 700 ? 800 : 800 });
      await page.addInitScript((value) => {
        try {
          window.localStorage.setItem("imobflux:theme", value);
        } catch {
          // sem armazenamento
        }
      }, theme);
      const response = await page.goto("/esta-pagina-nao-existe");
      expect(response?.status()).toBe(404);
      await expect(page.getByTestId("not-found-screen")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
      await expect(page.getByText("O endereço não existe ou foi movido.")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");

      const link = page.getByRole("link", { name: "Ir para o Hoje" });
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Nada técnico na tela.
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toMatch(/stack|exception|digest|supabase|postgres|at \w+\.\w+/);

      const violations = await auditContrast(page);
      expect(violations, JSON.stringify(violations)).toEqual([]);

      // O botão leva ao Hoje (que pede login quando não há sessão).
      await link.click();
      await expect(page).toHaveURL(/\/(hoje|login)/);
    });
  }
}
