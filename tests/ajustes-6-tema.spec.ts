import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { auditContrast } from "./helpers/contrast";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Ajustes 6 — contraste (WCAG AA) e capturas (FORA do repositório) do que é novo, nos dois temas: cabeçalho enxuto, folha ⋯ com as
// ações, menu ☰ com fundo escuro, Preferências no iPhone (aviso honesto e instalação) e a miniatura que não carregou.

const JID = "5582988886701@s.whatsapp.net";
const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
let conversation = "";

test.describe("Ajustes 6 — contraste e capturas", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    conversation = await ingestText(request, { jid: JID, text: "Mensagem do cliente", pushName: "Cliente Tema Seis" });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} 390px`, async ({ browser }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: theme, hasTouch: true, isMobile: true, userAgent: IPHONE_UA });
      const page: Page = await context.newPage();
      await page.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
      await loginAsDemoOwner(page);
      const found: Record<string, unknown[]> = {};
      const check = async (name: string) => {
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(CAPTURES, `ajustes6-${theme}-390-${name}.png`) });
        const violations = await auditContrast(page);
        if (violations.length > 0) found[name] = violations;
      };

      await page.goto(`/conversas/${conversation}`);
      await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
      await check("cabecalho-enxuto");

      await page.getByTestId("conversation-more").tap();
      await expect(page.getByTestId("conversation-more-sheet")).toBeVisible();
      await check("folha-acoes");
      await page.keyboard.press("Escape");

      await page.goto("/conversas");
      await page.getByRole("button", { name: "Abrir menu principal" }).tap();
      await expect(page.getByTestId("nav-backdrop")).toBeVisible();
      await check("menu-fundo-escuro");
      await page.keyboard.press("Escape");

      await page.goto("/preferencias");
      await expect(page.getByTestId("ios-notice")).toBeVisible();
      await check("preferencias-iphone");
      await page.getByTestId("notif-test").tap();
      await expect(page.getByTestId("notif-test-result")).toContainText("Teste das");
      await check("preferencias-iphone-teste");

      expect(found, `violações de contraste (${theme}): ${JSON.stringify(found, null, 1).slice(0, 2500)}`).toEqual({});
      await context.close();
    });

    test(`${theme} 1440px`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
      const page: Page = await context.newPage();
      await page.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
      await loginAsDemoOwner(page);
      await page.goto("/preferencias");
      await expect(page.getByTestId("install-help")).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(CAPTURES, `ajustes6-${theme}-1440-preferencias.png`) });
      const violations = await auditContrast(page);
      expect(violations, `violações (${theme} 1440): ${JSON.stringify(violations, null, 1).slice(0, 2500)}`).toEqual([]);
      await context.close();
    });
  }
});
