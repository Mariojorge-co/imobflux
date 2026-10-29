import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { auditContrast } from "./helpers/contrast";
import { loginAsDemoAttendant, loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Tema claro/escuro/automático: troca, persistência, sem piscar, e auditoria de contraste (WCAG AA) com capturas de tela
// (salvas FORA do repositório) em 390 e 1440 de largura, nos dois temas.

const FAKE_PORT = 3099;
const JID = "5582988880101@s.whatsapp.net";
const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");

let fake: FakeEvolution;
let conversation = "";

const PAGES = ["/hoje", "/conversas", "/kanban", "/contatos", "/tarefas", "/configuracoes", "/preferencias"];

async function setTheme(page: Page, preference: "light" | "dark" | "system") {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("imobflux:theme", value);
    } catch {
      // ignora
    }
  }, preference);
}

test.describe("Tema claro e escuro", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Bom dia! Quero saber o valor do terreno", pushName: "Cliente Tema" });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test("automático segue o sistema; escolher claro/escuro vale e persiste; sem piscar ao carregar", async ({ browser }) => {
    test.setTimeout(180_000);
    // Sistema escuro + automático = escuro, já antes da hidratação (a classe está no <html> no DOMContentLoaded).
    const dark = await browser.newContext({ colorScheme: "dark" });
    const darkPage = await dark.newPage();
    await darkPage.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __darkAtParse: boolean }).__darkAtParse = document.documentElement.classList.contains("dark");
      });
    });
    await loginAsDemoOwner(darkPage);
    await darkPage.goto("/preferencias");
    expect(await darkPage.evaluate(() => (window as unknown as { __darkAtParse: boolean }).__darkAtParse)).toBe(true);
    await expect(darkPage.locator("html")).toHaveClass(/dark/);
    expect(await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 17, 32)");

    // Escolher "Claro" vence o sistema e persiste após recarregar e em outra página.
    await darkPage.getByTestId("theme-option-light").click();
    await expect(darkPage.locator("html")).not.toHaveClass(/dark/);
    await darkPage.reload();
    await expect(darkPage.locator("html")).not.toHaveClass(/dark/);
    expect(await darkPage.evaluate(() => (window as unknown as { __darkAtParse: boolean }).__darkAtParse)).toBe(false);
    await darkPage.goto("/tarefas");
    await expect(darkPage.locator("html")).not.toHaveClass(/dark/);

    // Botão do topo: claro → escuro → automático → claro.
    const cycle = darkPage.getByTestId("theme-cycle");
    await expect(cycle).toHaveAttribute("data-theme-preference", "light");
    await cycle.click();
    await expect(cycle).toHaveAttribute("data-theme-preference", "dark");
    await expect(darkPage.locator("html")).toHaveClass(/dark/);
    await cycle.click();
    await expect(cycle).toHaveAttribute("data-theme-preference", "system");
    await expect(darkPage.locator("html")).toHaveClass(/dark/); // sistema escuro
    await cycle.click();
    await expect(cycle).toHaveAttribute("data-theme-preference", "light");
    await expect(darkPage.locator("html")).not.toHaveClass(/dark/);
    await dark.close();

    // Sistema claro + automático = claro; "escuro" escolhido vence o sistema.
    const light = await browser.newContext({ colorScheme: "light" });
    const lightPage = await light.newPage();
    await loginAsDemoOwner(lightPage);
    await lightPage.goto("/preferencias");
    await expect(lightPage.locator("html")).not.toHaveClass(/dark/);
    await lightPage.getByTestId("theme-option-dark").click();
    await expect(lightPage.locator("html")).toHaveClass(/dark/);
    await lightPage.reload();
    await expect(lightPage.locator("html")).toHaveClass(/dark/);
    await light.close();
  });

  test("armazenamento bloqueado não quebra: cai no tema do sistema", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("bloqueado", "SecurityError");
        },
      });
    });
    await page.goto("/login");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await context.close();
  });

});

// A auditoria de contraste não depende dos testes acima: roda em modo normal (uma falha não pula as outras).
test.describe("Contraste AA e capturas", () => {
  test.describe.configure({ mode: "default" });
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Bom dia! Quero saber o valor do terreno", pushName: "Cliente Tema" });
  });
  test.afterAll(async () => {
    await fake?.close();
  });

  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      test(`contraste AA e capturas — tema ${theme}, ${width}px`, async ({ browser }) => {
        test.setTimeout(300_000);
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
        const page = await context.newPage();
        await setTheme(page, theme);
        await loginAsDemoOwner(page);
        const report: Record<string, unknown[]> = {};
        const targets = [...PAGES, `/conversas/${conversation}`];
        for (const target of targets) {
          await page.goto(target);
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(1200);
          const name = target.replace(/\//g, "_").replace(/^_/, "") || "raiz";
          await page.screenshot({ path: path.join(CAPTURES, `${theme}-${width}-${name}.png`), fullPage: false });
          const violations = await auditContrast(page);
          if (violations.length > 0) report[target] = violations;
        }
        const total = Object.values(report).reduce((sum, list) => sum + list.length, 0);
        if (total > 0) console.log(`CONTRASTE ${theme} ${width}px:`, JSON.stringify(report, null, 1).slice(0, 6000));
        expect(total, `violações de contraste em ${theme}/${width}`).toBe(0);
        await context.close();
      });
    }
  }

});

test.describe("Tema do atendente", () => {
  test("atendente também escolhe o tema (a tela de preferências não é só do dono)", async ({ page }) => {
    await loginAsDemoAttendant(page);
    await page.goto("/preferencias");
    await expect(page.getByRole("heading", { name: "Preferências" })).toBeVisible();
    await page.getByTestId("theme-option-dark").click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
