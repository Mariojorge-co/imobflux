import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { auditContrast } from "./helpers/contrast";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Hoje unificado — contraste (WCAG AA) nos dois temas: a tela única com todas as seções e a higiene de cadastro aberta.

const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");


test.describe("Hoje unificado — contraste e capturas", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    await ingestText(request, { jid: "5582988887799@s.whatsapp.net", text: "Mensagem do cliente", pushName: "Cliente Tema Hoje" });
  });

  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [[390, 844], [1440, 900]] as const) {
      test(`${theme} ${width}px`, async ({ browser }) => {
        test.setTimeout(240_000);
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, hasTouch: width < 1000, isMobile: width < 1000 });
        const page = await context.newPage();
        await page.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
        await loginAsDemoOwner(page);
        const found: Record<string, unknown[]> = {};
        const check = async (name: string) => {
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(CAPTURES, `hoje-unificado-${theme}-${width}-${name}.png`) });
          const violations = await auditContrast(page);
          if (violations.length > 0) found[name] = violations;
        };

        await page.goto("/hoje");
        await expect(page.getByTestId("hoje-counters")).toBeVisible();
        await check("hoje-fechado");
        await page.getByTestId("hoje-hygiene-details").locator("summary").click();
        await expect(page.getByTestId("hoje-hygiene-pending")).toBeVisible();
        await page.getByTestId("hoje-hygiene").scrollIntoViewIfNeeded();
        await check("hoje-higiene-aberta");

        expect(found, `violações de contraste (${theme} ${width}): ${JSON.stringify(found, null, 1).slice(0, 2500)}`).toEqual({});
        await context.close();
      });
    }
  }
});
