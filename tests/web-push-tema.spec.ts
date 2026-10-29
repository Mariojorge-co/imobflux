import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { auditContrast } from "./helpers/contrast";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { clearSubscriptions, insertFakeSubscription, installFakePush, ownerMemberId } from "./helpers/push";

// Web Push — contraste (WCAG AA) nos dois temas: a seção "Avisos neste aparelho" ativa (com lista de aparelhos), a orientação de
// instalar no iPhone, a de permissão negada, e a seção "Cadastros a completar" do Hoje aberta. A assinatura do navegador é falsa.

const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

test.describe("Web Push — contraste e capturas", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!process.env.VAPID_PRIVATE_KEY, "o servidor de teste está sem chaves VAPID");

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    clearSubscriptions();
  });

  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [[390, 844], [1440, 900]] as const) {
      test(`${theme} ${width}px`, async ({ browser }) => {
        test.setTimeout(240_000);
        const mobile = width < 1000;
        const found: Record<string, unknown[]> = {};
        const open = async (name: string, options: { userAgent?: string; standalone?: boolean; denied?: boolean; active?: boolean }) => {
          const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, hasTouch: mobile, isMobile: mobile, userAgent: options.userAgent });
          await context.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
          if (options.denied) await context.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "denied", configurable: true }));
          if (options.active) {
            await context.grantPermissions(["notifications"]);
            await installFakePush(context, `tema-${theme}-${width}`);
          }
          const page = await context.newPage();
          await loginAsDemoOwner(page);
          await page.goto("/preferencias");
          const settings = page.getByTestId("push-settings");
          if (options.active) {
            await page.getByTestId("push-enable").click();
            await expect(settings).toHaveAttribute("data-push-state", "active");
            await expect(page.getByTestId("push-device")).toHaveCount(2);
          }
          await settings.scrollIntoViewIfNeeded();
          await page.waitForTimeout(600);
          await page.screenshot({ path: path.join(CAPTURES, `web-push-${theme}-${width}-${name}.png`) });
          const violations = await auditContrast(page);
          if (violations.length > 0) found[name] = violations;
          await context.close();
        };

        insertFakeSubscription(ownerMemberId(), `https://192.0.2.${width % 200}/push/tema-${theme}`, "ios");
        await open("ativo-com-lista", { active: true });
        await open("instalar-iphone", { userAgent: IPHONE_UA });
        await open("negada", { denied: true });

        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, hasTouch: mobile, isMobile: mobile });
        await context.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
        const page = await context.newPage();
        await loginAsDemoOwner(page);
        await page.getByTestId("hoje-hygiene-details").locator("summary").click();
        await expect(page.getByTestId("hoje-hygiene-pending")).toBeVisible();
        await page.getByTestId("hoje-hygiene").scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(CAPTURES, `web-push-${theme}-${width}-cadastros-a-completar.png`) });
        const violations = await auditContrast(page);
        if (violations.length > 0) found["cadastros-a-completar"] = violations;
        await context.close();

        clearSubscriptions();
        expect(found, `violações de contraste (${theme} ${width}): ${JSON.stringify(found, null, 1).slice(0, 2500)}`).toEqual({});
      });
    }
  }
});
