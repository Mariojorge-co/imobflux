import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { auditContrast } from "./helpers/contrast";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Auditoria de contraste (WCAG AA) e capturas (FORA do repositório) das telas novas do pacote: busca global aberta, resposta
// rápida com anexo (formulário e painel na conversa), conversa "rica" (cliente, equipe, citação) e Hoje com dados.

const JID = "5582988880801@s.whatsapp.net";
const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n% teste\n"), Buffer.alloc(3000, 0x20)]);
let conversation = "";

test.describe("Telas novas — contraste e capturas", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    conversation = await ingestText(request, { jid: JID, text: "Bom dia! Quero saber o valor do apartamento", pushName: "Cliente Capturas" });
    await ingestText(request, { jid: JID, text: "Pode me mandar a tabela de preços?", pushName: "Cliente Capturas", id: "cap-2" });
    await ingestText(request, { jid: JID, text: "Claro! Segue a tabela de preços em anexo.", fromMe: true, pushName: "Cliente Capturas", id: "cap-3" });
    await ingestText(request, { jid: JID, text: "Obrigado, vou analisar o apartamento", pushName: "Cliente Capturas", id: "cap-4" });
  });

  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      test(`${theme} ${width}px`, async ({ browser }) => {
        test.setTimeout(300_000);
        const context = await browser.newContext({
          viewport: { width, height },
          colorScheme: theme,
          hasTouch: width < 1000,
          isMobile: width < 1000,
        });
        const page = await context.newPage();
        await page.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
        await loginAsDemoOwner(page);
        const found: Record<string, unknown[]> = {};
        const check = async (name: string) => {
          await page.waitForTimeout(800);
          await page.screenshot({ path: path.join(CAPTURES, `novas-${theme}-${width}-${name}.png`) });
          const violations = await auditContrast(page);
          if (violations.length > 0) found[name] = violations;
        };

        // conversa rica
        await page.goto(`/conversas/${conversation}`);
        await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
        await check("conversa-rica");

        // busca global com resultados
        await page.getByTestId("global-search-button").click();
        await page.getByTestId("global-search-input").fill("apartamento");
        await expect(page.getByTestId("global-search-result").first()).toBeVisible({ timeout: 30_000 });
        await check("busca-global");
        await page.keyboard.press("Escape");

        // resposta rápida com anexo (formulário)
        await page.goto("/configuracoes/respostas-rapidas");
        await page.getByRole("button", { name: "Nova resposta" }).first().click();
        const dialog = page.locator("dialog[open]");
        await dialog.getByLabel("Título").fill("Tabela de preços");
        await dialog.getByLabel("Texto da mensagem").fill("Olá {{nome}}, segue a tabela de preços.");
        await dialog.getByTestId("quick-reply-file-input").setInputFiles([{ name: "tabela.pdf", mimeType: "application/pdf", buffer: PDF }]);
        await expect(dialog.getByTestId("quick-reply-attachment-new")).toHaveCount(1);
        await check("resposta-com-anexo");
        await dialog.getByRole("button", { name: "Salvar" }).click();
        await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 60_000 });

        // uso na conversa: painel e bandeja
        await page.goto(`/conversas/${conversation}`);
        await page.getByTestId("quick-replies-button").click();
        await expect(page.getByTestId("quick-replies-panel")).toBeVisible();
        await check("painel-respostas");
        await page.getByTestId("quick-replies-panel").getByRole("button", { name: /Tabela de preços/ }).first().click();
        await expect(page.getByTestId("outgoing-item").first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(1, { timeout: 60_000 });
        await check("bandeja-anexo");

        // Hoje com dados e avisos
        await page.goto("/hoje");
        await expect(page.getByTestId("hoje-counters")).toBeVisible();
        await check("hoje-com-dados");
        await page.goto("/preferencias");
        await check("preferencias-avisos");

        const total = Object.values(found).reduce((sum, list) => sum + list.length, 0);
        if (total > 0) console.log(`CONTRASTE ${theme} ${width}px:`, JSON.stringify(found, null, 1).slice(0, 6000));
        expect(total, `violações de contraste em ${theme}/${width}`).toBe(0);
        await context.close();
      });
    }
  }
});
