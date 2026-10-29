import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { auditContrast } from "./helpers/contrast";
import { loginAsDemoOwner, resetAndLoadDemoMode, queryLocalSql } from "./helpers/local-test-state";
import { activeInstance, ingestText, postWebhook } from "./helpers/webhook";

// Contraste (WCAG AA) e capturas (FORA do repositório) das telas das correções 1 a 4 nos dois temas: marca "enviada ao WhatsApp",
// nota interna, aviso de vídeo grande, cartão do WhatsApp em Configurações, folha do menu e confirmação de Sair no celular.

const FAKE_PORT = 3099;
const JID = "5582988884601@s.whatsapp.net";
const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");
let fake: FakeEvolution;
let conversation = "";
let counter = 0;

test.describe("Telas das correções — contraste e capturas", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Mensagem do cliente para o tema", pushName: "Cliente Tema" });
    const response = await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: {
        key: { remoteJid: JID, fromMe: false, id: "TEMA-BIG-VIDEO" },
        pushName: "Cliente Tema",
        message: { videoMessage: { mimetype: "video/mp4", fileLength: 60 * 1024 * 1024 } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(response.ok()).toBe(true);
    expect(queryLocalSql("select count(*) from public.attachments where status = 'unavailable';")).not.toBe("0");
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      test(`${theme} ${width}px`, async ({ browser }) => {
        test.setTimeout(300_000);
        fake.reset();
        counter += 1;
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, hasTouch: width < 1000, isMobile: width < 1000 });
        const page: Page = await context.newPage();
        await page.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
        await loginAsDemoOwner(page);
        const found: Record<string, unknown[]> = {};
        const check = async (name: string) => {
          await page.waitForTimeout(800);
          await page.screenshot({ path: path.join(CAPTURES, `correcoes-${theme}-${width}-${name}.png`) });
          const violations = await auditContrast(page);
          if (violations.length > 0) found[name] = violations;
        };

        await page.goto(`/conversas/${conversation}`);
        const box = page.getByLabel("Digitar mensagem de texto");
        await expect(box).toBeVisible();
        const history = page.getByLabel("Histórico de mensagens");

        // aviso final de vídeo grande
        await expect(page.getByTestId("attachment-unavailable").first()).toContainText("Arquivo grande demais");
        await check("video-grande");

        // mensagem nossa editada: marca "enviada ao WhatsApp" (60 s)
        const original = `Minha mensagem do tema ${counter}`;
        await box.fill(original);
        await page.keyboard.press("Enter");
        const mine = history.locator("[data-message-id]").filter({ hasText: original }).first();
        await expect(mine).toBeVisible();
        await expect(history.getByTestId("message-sending")).toHaveCount(0, { timeout: 30_000 });
        await mine.hover();
        await mine.getByTestId("message-menu-button").click();
        if (width < 768) await check("folha-menu");
        await page.getByTestId("action-edit").click();
        await box.fill(`${original} editada`);
        await page.keyboard.press("Enter");
        await expect(history.locator("[data-message-id]").filter({ hasText: "editada" }).first().getByTestId("wa-pending")).toBeVisible({ timeout: 30_000 });
        await check("enviada-ao-whatsapp");

        // citação com "Você" e nota interna
        await page.getByRole("button", { name: "Nota interna" }).click();
        await page.getByLabel("Digitar nota interna (apenas CRM)").fill(`Nota do tema ${counter}`);
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("internal-note").filter({ hasText: `Nota do tema ${counter}` })).toBeVisible();
        await check("nota-interna");

        // cartão do WhatsApp em Configurações
        await page.goto("/configuracoes/whatsapp");
        await expect(page.getByTestId("webhook-events-card")).toBeVisible();
        await check("whatsapp-cartao");

        // confirmação de Sair (só no celular)
        if (width < 768) {
          await page.goto("/hoje");
          await page.getByRole("button", { name: "Abrir menu principal" }).click();
          await check("menu-celular");
          await page.getByTestId("logout-menu-button").click();
          await expect(page.getByRole("alertdialog", { name: "Sair do ImobFlux?" })).toBeVisible();
          await check("sair-confirmacao");
        }

        const total = Object.values(found).reduce((sum, list) => sum + list.length, 0);
        if (total > 0) console.log(`CONTRASTE ${theme} ${width}px:`, JSON.stringify(found, null, 1).slice(0, 6000));
        expect(total, `violações de contraste em ${theme}/${width}`).toBe(0);
        await context.close();
      });
    }
  }
});
