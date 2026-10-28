import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { auditContrast } from "./helpers/contrast";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Ajustes 5 — contraste (WCAG AA) e capturas (FORA do repositório) das telas novas nos dois temas, em 1440 e 390: painel de avisos
// e diagnóstico, seletor de emoji, "Rascunho:" na lista, folha do ⋯ e ajuda de atalhos pelo menu do celular.

const JID_A = "5582988887101@s.whatsapp.net";
const JID_B = "5582988887102@s.whatsapp.net";
const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");
let convA = "";
let convB = "";

test.describe("Ajustes 5 — contraste e capturas", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    convA = await ingestText(request, { jid: JID_A, text: "Mensagem do cliente A", pushName: "Cliente Tema A" });
    convB = await ingestText(request, { jid: JID_B, text: "Mensagem do cliente B", pushName: "Cliente Tema B" });
  });

  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      test(`${theme} ${width}px`, async ({ browser }) => {
        test.setTimeout(300_000);
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, hasTouch: width < 1000, isMobile: width < 1000 });
        const page: Page = await context.newPage();
        await page.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
        await loginAsDemoOwner(page);
        const found: Record<string, unknown[]> = {};
        const check = async (name: string) => {
          await page.waitForTimeout(700);
          await page.screenshot({ path: path.join(CAPTURES, `ajustes5-${theme}-${width}-${name}.png`) });
          const violations = await auditContrast(page);
          if (violations.length > 0) found[name] = violations;
        };
        const press = (locator: ReturnType<Page["locator"]>) => (width < 1000 ? locator.tap() : locator.click());

        // Preferências: avisos, painel de diagnóstico e guia por aparelho (depois do teste, com resultado na tela).
        await page.goto("/preferencias");
        await expect(page.getByTestId("notification-diagnostics")).toBeVisible();
        await expect(page.getByTestId("diag-realtime")).toHaveText("conectada", { timeout: 30_000 });
        await check("avisos-diagnostico");
        await press(page.getByTestId("notif-test"));
        await expect(page.getByTestId("notif-test-result")).toContainText("Teste das");
        await check("avisos-teste");

        // Rascunho na lista: texto numa conversa, olhando outra.
        await page.goto(`/conversas/${convA}`);
        // Espera a conversa hidratar: um clique antes disso na lista não navega.
        await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
        const box = page.getByLabel("Digitar mensagem de texto");
        await expect(box).toBeVisible();
        await box.fill(`Rascunho do tema ${theme} ${width}`);
        if (width >= 1000) {
          await press(page.locator(`#conv-card-${convB}`));
          await expect(page).toHaveURL(new RegExp(`/conversas/${convB}$`), { timeout: 20_000 });
          await expect(page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft")).toBeVisible({ timeout: 15_000 });
          await check("lista-rascunho");
          await press(page.locator(`#conv-card-${convA}`));
          await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`), { timeout: 20_000 });
          await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
          await expect(box).toBeVisible();
          await expect(box).toHaveValue(/Rascunho do tema/);

          // Seletor de emoji (só no computador).
          await press(page.getByTestId("emoji-insert-button"));
          await expect(page.getByTestId("emoji-insert-panel")).toBeVisible();
          await check("emoji-categorias");
          await page.getByTestId("emoji-insert-search").fill("casa");
          await check("emoji-busca");
          await page.keyboard.press("Escape");
        } else {
          await page.goto("/conversas");
          await expect(page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft")).toBeVisible();
          await check("lista-rascunho");
          await page.goto(`/conversas/${convA}`);
          await press(page.getByTestId("conversation-more"));
          await expect(page.getByTestId("conversation-more-sheet")).toBeVisible();
          await check("folha-mais");
          await page.keyboard.press("Escape");
          await page.goto("/conversas");
          await press(page.getByRole("button", { name: "Abrir menu principal" }));
          await check("menu-celular");
          await press(page.getByTestId("menu-shortcuts"));
          await expect(page.getByTestId("shortcuts-help")).toBeVisible();
          await check("ajuda-atalhos");
        }

        const total = Object.values(found).reduce((sum, list) => sum + list.length, 0);
        if (total > 0) console.log(`CONTRASTE ${theme} ${width}px:`, JSON.stringify(found, null, 1).slice(0, 6000));
        expect(total, `violações de contraste em ${theme}/${width}`).toBe(0);
        await context.close();
      });
    }
  }
});
