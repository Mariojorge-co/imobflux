import { expect, test, type Browser, type Page } from "@playwright/test";
import { auditFields, below16, type FieldInfo } from "./helpers/field-audit";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Ajustes 7 — (A) todo campo do app com 16 px computados no celular (iOS dá zoom com menos que isso), (B) sem faixa de outra cor
// abaixo da caixa de mensagem no app instalado (standalone), (C) painel de diagnóstico de tela (temporário).
// Chrome com toque emula tamanho e toque; o iPhone real confirma o resto (ver docs/RELATORIO_AJUSTES_7.md).

const JID = "5582988887701@s.whatsapp.net";
let conversation = "";
const WIDTHS = [360, 390, 430] as const;

async function phone(browser: Browser, width: number, height = 844, extra: Record<string, unknown> = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, ...extra });
  const page = await context.newPage();
  return { context, page };
}

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);
}

test.describe("Ajustes 7", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    conversation = await ingestText(request, { jid: JID, text: "Mensagem do cliente", pushName: "Cliente Ajustes Sete" });
    // Mensagens suficientes para a lista rolar por dentro.
    for (let index = 1; index <= 22; index += 1) {
      await ingestText(request, { jid: JID, text: `Mensagem ${index} para dar rolagem`, pushName: "Cliente Ajustes Sete" });
    }
  });

  test("aquecimento", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await phone(browser, 390);
    await loginAsDemoOwner(page);
    for (const route of ["/conversas", `/conversas/${conversation}`, "/contatos", "/kanban", "/tarefas", "/hoje", "/prioridades", "/preferencias", "/configuracoes/respostas-rapidas", "/configuracoes/equipe", "/configuracoes/prazos", "/configuracoes/grupos", "/configuracoes/whatsapp", "/configuracoes/auditoria", "/configuracoes/exportacao"]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
    }
    await context.close();
  });

  // ─── A: campos com 16 px reais ──────────────────────────────────────────────────────────────────────────────────────
  for (const width of WIDTHS) {
    test(`A: todo campo visível tem font-size computado >= 16px em ${width}px (login e telas principais)`, async ({ browser }) => {
      test.setTimeout(420_000);
      const { context, page } = await phone(browser, width);
      const offenders: Record<string, FieldInfo[]> = {};
      const seen: Record<string, number> = {};
      const check = async (name: string) => {
        await settle(page);
        const fields = await auditFields(page);
        seen[name] = fields.length;
        const bad = below16(fields);
        if (bad.length > 0) offenders[name] = bad;
      };

      await page.goto("/login");
      await check("login");
      await loginAsDemoOwner(page);

      for (const [name, route] of [
        ["conversas-lista", "/conversas"],
        ["contatos", "/contatos"],
        ["kanban", "/kanban"],
        ["tarefas", "/tarefas"],
        ["hoje", "/hoje"],
        ["prioridades", "/prioridades"],
        ["preferencias", "/preferencias"],
        ["respostas-rapidas", "/configuracoes/respostas-rapidas"],
        ["equipe", "/configuracoes/equipe"],
        ["prazos", "/configuracoes/prazos"],
        ["grupos", "/configuracoes/grupos"],
        ["whatsapp", "/configuracoes/whatsapp"],
        ["auditoria", "/configuracoes/auditoria"],
        ["exportacao", "/configuracoes/exportacao"],
      ] as const) {
        await page.goto(route);
        await check(name);
      }

      // Conversa: mensagem, nota interna, busca na conversa, respostas rápidas, folha ⋯, busca global.
      await page.goto(`/conversas/${conversation}`);
      await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
      await check("conversa-mensagem");
      await page.getByRole("button", { name: "Nota interna" }).tap();
      await check("conversa-nota");
      await page.getByRole("button", { name: "Mensagem", exact: true }).tap();
      await page.getByTestId("conversation-search-toggle").tap();
      await check("conversa-busca");
      await page.getByTestId("conversation-search-toggle").tap();
      await page.getByTestId("quick-replies-button").tap();
      await expect(page.getByTestId("quick-replies-panel")).toBeVisible();
      await check("respostas-rapidas-painel");
      await page.keyboard.press("Escape");
      await page.getByTestId("conversation-more").tap();
      await expect(page.getByTestId("conversation-more-sheet")).toBeVisible();
      await check("folha-mais");
      await page.keyboard.press("Escape");
      await page.getByTestId("global-search-button").tap();
      await expect(page.getByTestId("global-search")).toBeVisible();
      await check("busca-global");
      await page.keyboard.press("Escape");

      await context.close();
      const summary = Object.entries(offenders).map(([name, list]) => `${name}: ${list.map((f) => `${f.tag}[${f.label}]=${f.fontSize}px`).join("; ")}`);
      expect(summary, `campos abaixo de 16px em ${width}px (telas auditadas: ${JSON.stringify(seen)})`).toEqual([]);
      // Sanidade: a auditoria olhou campos de verdade.
      expect(seen["conversa-mensagem"]).toBeGreaterThan(0);
      expect(seen["login"]).toBeGreaterThan(0);
    });
  }

  // Este teste FALHA com a regra antiga (classe/ID/inline vencem uma regra simples) e passa com a nova (`!important` + guarda no foco).
  for (const width of WIDTHS) {
    test(`A: campo com estilo que tenta diminuir a fonte (inline, ID, !important) continua com 16px em ${width}px`, async ({ browser }) => {
      test.setTimeout(180_000);
      const { context, page } = await phone(browser, width);
      await loginAsDemoOwner(page);
      await page.goto(`/conversas/${conversation}`);
      await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
      const box = page.getByLabel("Digitar mensagem de texto");
      await expect(box).toBeVisible();

      await page.addStyleTag({
        content: `
          #hostile-id { font-size: 11px; }
          .hostile-important { font-size: 11px !important; }
          html body #hostile-strong { font-size: 10px !important; position: fixed; top: 0; left: 0; z-index: 99999; width: 200px; height: 44px; }
        `,
      });
      await page.evaluate(() => {
        const make = (tag: string, attrs: Record<string, string>) => {
          const element = document.createElement(tag);
          for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
          element.setAttribute("aria-label", attrs.id);
          document.body.appendChild(element);
          return element;
        };
        make("input", { id: "hostile-id", type: "text" });
        make("input", { id: "hostile-class", type: "search", class: "hostile-important" });
        make("textarea", { id: "hostile-strong" });
        make("input", { id: "hostile-inline", type: "text", style: "font-size: 12px" });
        const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Digitar mensagem de texto"]')!;
        composer.style.fontSize = "13px";
      });

      const size = (selector: string) => page.locator(selector).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      // Sem foco: a regra de CSS (com !important) já vence ID, classe e inline.
      expect(await size("#hostile-id"), "ID").toBeGreaterThanOrEqual(16);
      expect(await size("#hostile-class"), "classe !important").toBeGreaterThanOrEqual(16);
      expect(await size("#hostile-inline"), "inline").toBeGreaterThanOrEqual(16);
      expect(await box.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)), "caixa de mensagem com inline 13px").toBeGreaterThanOrEqual(16);
      // Regra mais específica com !important vence o CSS, mas a guarda corrige no toque/foco (antes de o iOS decidir dar zoom).
      await page.locator("#hostile-strong").tap();
      expect(await size("#hostile-strong"), "especificidade maior + !important").toBeGreaterThanOrEqual(16);
      await context.close();
    });
  }

  test("A: a regra vale também em tela larga com toque (tablet/dispositivo sem hover) e some do computador com mouse", async ({ browser }) => {
    test.setTimeout(180_000);
    // Tablet 1024 com toque: pointer coarse, sem largura de celular.
    const tablet = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
    const touchPage = await tablet.newPage();
    await loginAsDemoOwner(touchPage);
    await touchPage.goto("/contatos");
    await settle(touchPage);
    const touchFields = await auditFields(touchPage);
    expect(touchFields.length).toBeGreaterThan(0);
    expect(below16(touchFields)).toEqual([]);
    await tablet.close();

    // Computador com mouse: os campos compactos continuam compactos (a regra é só para celular/toque).
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const mousePage = await desktop.newPage();
    await loginAsDemoOwner(mousePage);
    await mousePage.goto("/contatos");
    await settle(mousePage);
    const mouseFields = await auditFields(mousePage);
    expect(mouseFields.length).toBeGreaterThan(0);
    expect(below16(mouseFields).length, "campos continuam compactos no computador").toBeGreaterThan(0);
    await desktop.close();
  });

  test("A: o zoom de acessibilidade continua liberado (sem maximum-scale, sem user-scalable)", async ({ page }) => {
    await page.goto("/login");
    const viewport = (await page.locator('meta[name="viewport"]').getAttribute("content")) ?? "";
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
    expect(viewport).toContain("initial-scale=1");
  });

  // ─── B: faixa de baixo no app instalado ─────────────────────────────────────────────────────────────────────────────
  // O Chrome não consegue emular o modo "standalone" nem a barra de início do iPhone: aqui confere-se a geometria que impede a
  // faixa (moldura até a borda de baixo, página que não rola, fundos iguais ao do app). A área da barra de início só o iPhone confirma.
  for (const theme of ["light", "dark"] as const) {
    test(`B: conversa ocupa a tela inteira, a página não rola/estica e os fundos são os do app (${theme})`, async ({ browser }) => {
      test.setTimeout(180_000);
      const { context, page } = await phone(browser, 390, 844, { colorScheme: theme });
      await page.addInitScript((value) => window.localStorage.setItem("imobflux:theme", value), theme);
      await loginAsDemoOwner(page);
      await page.goto(`/conversas/${conversation}`);
      await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
      const geometry = await page.evaluate(() => {
        const doc = document.documentElement;
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const token = getComputedStyle(doc).getPropertyValue("--color-background").trim();
        const probe = document.createElement("div");
        probe.style.color = token;
        document.body.appendChild(probe);
        const appBackground = getComputedStyle(probe).color;
        probe.remove();
        const before = window.scrollY;
        window.scrollTo(0, 120);
        const scrolled = window.scrollY;
        window.scrollTo(0, before);
        const log = document.querySelector<HTMLElement>('[role="log"]')!;
        log.scrollTop = 0;
        const logCanScroll = log.scrollHeight > log.clientHeight;
        return {
          inner: window.innerHeight,
          docScrollHeight: doc.scrollHeight,
          frameBottom: rect('[data-testid="conversations-frame"]').bottom,
          composerBottom: rect('[data-testid="message-composer"]').bottom,
          htmlBg: getComputedStyle(doc).backgroundColor,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          appBackground,
          overscroll: [getComputedStyle(doc).overscrollBehaviorY, getComputedStyle(document.body).overscrollBehaviorY],
          pageScrolled: scrolled,
          logCanScroll,
          framePosition: getComputedStyle(document.querySelector('[data-testid="conversations-frame"]')!).position,
        };
      });
      expect(geometry.docScrollHeight).toBe(geometry.inner);
      expect(Math.round(geometry.frameBottom)).toBe(geometry.inner);
      expect(Math.round(geometry.composerBottom)).toBe(geometry.inner);
      expect(geometry.framePosition).toBe("fixed");
      expect(geometry.htmlBg).toBe(geometry.appBackground);
      expect(geometry.bodyBg).toBe(geometry.appBackground);
      expect(geometry.overscroll).toEqual(["none", "none"]);
      expect(geometry.pageScrolled, "a página não rola").toBe(0);
      expect(geometry.logCanScroll, "a lista de mensagens rola por dentro").toBe(true);
      // A rolagem interna das mensagens continua funcionando.
      const log = page.getByLabel("Histórico de mensagens");
      await log.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await context.close();
    });
  }

  test("B: a lista de conversas e as outras telas também não esticam a página e a base da caixa acompanha a área de segurança", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await phone(browser, 390);
    await loginAsDemoOwner(page);
    await page.goto("/conversas");
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBe(0);
    await page.goto("/preferencias");
    await settle(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("none");
    // A área de segurança de baixo fica DENTRO da caixa de mensagem (a caixa pinta essa área com a própria cor).
    await page.goto(`/conversas/${conversation}`);
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    const rule = await page.evaluate(() => {
      const composer = document.querySelector<HTMLElement>('[data-testid="message-composer"]')!;
      return { hasClass: composer.classList.contains("composer-safe"), bg: getComputedStyle(composer).backgroundColor };
    });
    expect(rule.hasClass).toBe(true);
    const css = await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((r) => r.cssText); } catch { return []; } }).join("\n"));
    expect(css).toMatch(/\.composer-safe[^}]*safe-area-inset-bottom/);
    await context.close();
  });

  // ─── C: diagnóstico de tela (temporário) ────────────────────────────────────────────────────────────────────────────
  test("C: Preferências tem o diagnóstico de tela recolhido; abre, mostra os números e copia sem enviar nada a servidor", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    const section = page.getByTestId("screen-diagnostics");
    await expect(section).toBeVisible();
    expect(await section.evaluate((element) => (element as HTMLDetailsElement).open), "começa recolhido").toBe(false);
    await expect(page.getByTestId("screen-diag-list").locator("dt")).toHaveCount(0);

    await section.locator("summary").tap();
    const list = page.getByTestId("screen-diag-list");
    await expect(list.locator("dt").first()).toBeVisible();
    for (const label of [
      "Janela (innerWidth x innerHeight)",
      "visualViewport (largura x altura, zoom, offsetTop)",
      "Tela (screen.width x height)",
      "devicePixelRatio",
      "navigator.standalone (iOS)",
      "display-mode: standalone",
      "Áreas seguras env(safe-area-inset-*)",
      "Fonte de um campo como a caixa de mensagem",
      "Fonte de um campo como a busca",
      "Documento: scrollHeight / clientHeight",
      "Fundo do html",
      "Fundo do body",
      "User agent",
    ]) {
      await expect(list.locator(`[data-diag-label="${label}"]`), label).toBeVisible();
    }
    // Os campos de teste medidos pela seção também têm 16px (a regra vale para eles).
    await expect(list.locator('[data-diag-label="Fonte de um campo como a caixa de mensagem"]')).toHaveText("16px");
    await expect(list.locator('[data-diag-label="Fonte de um campo como a busca"]')).toHaveText("16px");
    await expect(list.locator('[data-diag-label="Janela (innerWidth x innerHeight)"]')).toHaveText("390 x 844");

    // "Copiar": nenhuma requisição sai (nada vai a servidor) e o texto copiado traz os números.
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.getByTestId("screen-diag-copy").tap();
    await expect(page.getByTestId("screen-diag-copied")).toHaveText("Copiado.");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("diagnóstico de tela (temporário)");
    expect(copied).toContain("Janela (innerWidth x innerHeight): 390 x 844");
    expect(copied).toContain("User agent:");
    expect(copied).not.toMatch(/Mensagem do cliente/);
    expect(requests.filter((url) => !url.startsWith("data:") && !url.startsWith("blob:"))).toEqual([]);
    await context.close();
  });
});
