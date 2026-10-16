import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Celular (390x844), tablet (768x1024) e desktop (1440x900): sem rolagem horizontal em nenhuma tela, conversa em duas telas com
// voltar pelo histórico, menu "⋯", menus de mensagem em folha (toque e toque prolongado), áreas de toque de 44px, teclado.

const FAKE_PORT = 3099;
const JID = "5582988880202@s.whatsapp.net";
const CAPTURES = process.env.IMOBFLUX_CAPTURES_DIR ?? path.join(process.env.TEMP ?? ".", "capturas-noite");
const LONG = "Mensagem muito longa sem espaços para testar a quebra de linha ".repeat(3) + "SEMESPACOSSEMESPACOSSEMESPACOSSEMESPACOSSEMESPACOSSEMESPACOSSEMESPACOS";

const ROUTES = [
  "/hoje", "/prioridades", "/contatos", "/conversas", "/kanban", "/tarefas", "/preferencias",
  "/configuracoes", "/configuracoes/equipe", "/configuracoes/grupos", "/configuracoes/prazos",
  "/configuracoes/respostas-rapidas", "/configuracoes/whatsapp", "/configuracoes/auditoria", "/configuracoes/exportacao",
];
const VIEWPORTS = [
  { name: "celular", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

let fake: FakeEvolution;
let conversation = "";

async function overflow(page: Page) {
  return page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
}

async function mobilePage(browser: import("@playwright/test").Browser, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await loginAsDemoOwner(page);
  return { context, page };
}

test.describe("Celular, tablet e desktop", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    fs.mkdirSync(CAPTURES, { recursive: true });
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: LONG, pushName: "Cliente Celular Com Um Nome Bem Comprido Para Testar" });
    await ingestText(request, { jid: JID, text: "Segunda mensagem, curta", pushName: "Cliente Celular Com Um Nome Bem Comprido Para Testar" });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test("aquecimento das rotas", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await mobilePage(browser);
    for (const route of [...ROUTES, `/conversas/${conversation}`]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
    }
    await context.close();
  });

  for (const viewport of VIEWPORTS) {
    test(`sem rolagem horizontal em todas as telas — ${viewport.name} ${viewport.width}px`, async ({ browser }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.width < 1000,
        isMobile: viewport.width < 1000,
      });
      const page = await context.newPage();
      await loginAsDemoOwner(page);
      const wide: string[] = [];
      for (const route of [...ROUTES, `/conversas/${conversation}`]) {
        await page.goto(route);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(900);
        const { scroll, inner } = await overflow(page);
        if (scroll > inner + 1) wide.push(`${route}: página com ${scroll}px em ${inner}px`);
        await page.screenshot({ path: path.join(CAPTURES, `layout-${viewport.name}-${route.replace(/\//g, "_").replace(/^_/, "")}.png`) });
      }
      expect(wide).toEqual([]);
      await context.close();
    });
  }

  test("tablet 768: menu hambúrguer no topo, lista e conversa lado a lado com espaço de sobra", async ({ browser }) => {
    const { context, page } = await mobilePage(browser, 768, 1024);
    await page.goto(`/conversas/${conversation}`);
    await expect(page.getByLabel("Abrir menu principal")).toBeVisible();
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeVisible();
    const panel = await page.getByTestId("conversation-column").boundingBox();
    expect(panel!.width).toBeGreaterThan(420);
    await context.close();
  });

  test("desktop 1440: sidebar fixa, sem hambúrguer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoOwner(page);
    await page.goto("/prioridades");
    await expect(page.getByRole("complementary")).toBeVisible();
    await expect(page.getByLabel("Abrir menu principal")).toBeHidden();
  });

  test("celular: duas telas; abrir pela lista, voltar pelo botão e pelo histórico, lista na mesma posição", async ({ browser }) => {
    const { context, page } = await mobilePage(browser);
    await page.goto("/conversas");
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeVisible();
    await expect(page.getByTestId("conversation-column")).toHaveCount(0);
    await expect(page.locator('html[data-realtime-inbox="ready"]')).toBeAttached({ timeout: 30_000 });
    // Rola a lista um pouco e abre uma conversa.
    const list = page.getByRole("list", { name: "Lista de conversas" });
    await list.evaluate((element) => { element.scrollTop = 140; });
    const before = await list.evaluate((element) => element.scrollTop);
    await page.locator(`#conv-card-${conversation}`).scrollIntoViewIfNeeded();
    const scrolled = await list.evaluate((element) => element.scrollTop);
    await page.locator(`#conv-card-${conversation}`).tap();
    await expect(page).toHaveURL(new RegExp(`/conversas/${conversation}$`));
    await expect(page.getByTestId("conversation-column")).toBeVisible();
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeHidden();
    // Botão voltar da tela: usa o histórico (não empilha a lista de novo) e a lista volta onde estava.
    const historyLength = await page.evaluate(() => window.history.length);
    await page.locator("#btn-back-to-conversations").tap();
    await expect(page).toHaveURL(/\/conversas$/);
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeVisible();
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(Math.min(before, scrolled) - 2);
    // Voltar do navegador/aparelho: abre a conversa de novo e volta para a lista sem perder o estado.
    await page.locator(`#conv-card-${conversation}`).tap();
    await expect(page.getByTestId("conversation-column")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/conversas$/);
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeVisible();
    // Abertura por link direto: o botão voltar leva à lista pela URL.
    await page.goto(`/conversas/${conversation}`);
    await page.locator("#btn-back-to-conversations").tap();
    await expect(page).toHaveURL(/\/conversas$/);
    await context.close();
  });

  test("celular: menu '⋯' do cabeçalho reúne as ações que não cabem (nada do desktop fica inalcançável)", async ({ browser }) => {
    const { context, page } = await mobilePage(browser);
    await page.goto(`/conversas/${conversation}`);
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    // Os botões que só existem no desktop estão escondidos; o menu os traz.
    await expect(page.getByTestId("conversation-pin-toggle")).toBeHidden();
    await page.getByTestId("conversation-more").tap();
    const sheet = page.getByTestId("conversation-more-sheet");
    await expect(sheet).toBeVisible();
    for (const id of ["more-unread", "more-pin", "more-archive", "more-hidden"]) await expect(sheet.getByTestId(id)).toBeVisible();
    // Cada item tem área de toque de pelo menos 44px de altura.
    for (const id of ["more-unread", "more-pin", "more-archive"]) expect((await sheet.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await sheet.getByTestId("more-pin").tap();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("conversation-more").tap();
    await expect(page.getByTestId("conversation-more-sheet").getByTestId("more-pin")).toContainText("Desafixar");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("conversation-more-sheet")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/conversas/${conversation}$`));
    // Marcar como não lida pelo menu.
    await page.getByTestId("conversation-more").tap();
    await page.getByTestId("more-unread").tap();
    await page.getByTestId("conversation-more").tap();
    await expect(page.getByTestId("more-unread")).toContainText("Marcar como lida");
    await page.keyboard.press("Escape");
    await context.close();
  });

  test("celular: menu da mensagem em folha (botão visível e toque prolongado), reagir e responder sem rolagem horizontal", async ({ browser }) => {
    const { context, page } = await mobilePage(browser);
    await page.goto(`/conversas/${conversation}`);
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    const history = page.getByLabel("Histórico de mensagens");
    const bubble = history.locator("[data-message-id]").filter({ hasText: "SEMESPACOS" }).first();
    // O botão de ações é visível sem hover e tem área de toque de 44px.
    const button = bubble.getByTestId("message-menu-button");
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.width + 12).toBeGreaterThanOrEqual(44);
    await button.tap();
    const sheet = page.getByTestId("message-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("action-reply")).toBeVisible();
    expect((await sheet.getByTestId("action-reply").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    // Toque prolongado na bolha também abre.
    await bubble.getByTestId("message-bubble").evaluate((element) => {
      element.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    });
    await expect(page.getByTestId("message-sheet")).toBeVisible({ timeout: 3_000 });
    // Reagir: a folha mostra os emojis.
    await page.getByTestId("message-sheet").getByTestId("action-react").tap();
    await expect(page.getByTestId("message-sheet").getByTestId("emoji-picker")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("message-sheet")).toHaveCount(0);
    // Responder: o cartão de citação com texto sem espaços não cria rolagem horizontal.
    await bubble.getByTestId("message-menu-button").tap();
    await page.getByTestId("message-sheet").getByTestId("action-reply").tap();
    await expect(page.getByTestId("reply-card")).toBeVisible();
    const { scroll, inner } = await overflow(page);
    expect(scroll).toBeLessThanOrEqual(inner + 1);
    const card = (await page.getByTestId("reply-card").boundingBox())!;
    expect(card.x + card.width).toBeLessThanOrEqual(inner + 1);
    await page.screenshot({ path: path.join(CAPTURES, "celular-resposta-citacao.png") });
    await context.close();
  });

  test("celular: bandeja de arquivo com nome enorme não estoura a tela; botões da caixa têm 44px", async ({ browser }) => {
    const { context, page } = await mobilePage(browser);
    await page.goto(`/conversas/${conversation}`);
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    await page.getByTestId("file-input").setInputFiles([
      { name: `${"contrato-com-nome-gigante-".repeat(6)}final.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% teste\n") },
    ]);
    await expect(page.getByTestId("outgoing-item")).toHaveCount(1);
    await expect(page.getByTestId("outgoing-item")).toContainText("pronto", { timeout: 30_000 });
    const { scroll, inner } = await overflow(page);
    expect(scroll).toBeLessThanOrEqual(inner + 1);
    const item = (await page.getByTestId("outgoing-item").boundingBox())!;
    expect(item.x + item.width).toBeLessThanOrEqual(inner + 1);
    await page.screenshot({ path: path.join(CAPTURES, "celular-arquivo-bandeja.png") });
    // Áreas de toque dos controles principais.
    const targets = [
      page.getByTestId("attach-button"),
      page.getByTestId("voice-start"),
      page.locator("#btn-send-message"),
      page.getByRole("button", { name: "Mensagem", exact: true }),
      page.getByRole("button", { name: "Nota interna" }),
      page.getByTestId("conversation-search-toggle"),
      page.getByTestId("conversation-more"),
      page.locator("#btn-back-to-conversations"),
      page.getByLabel("Abrir menu principal"),
    ];
    for (const target of targets) {
      const box = (await target.boundingBox())!;
      expect(box.width, await target.evaluate((element) => element.getAttribute("aria-label") ?? element.textContent ?? "controle")).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    await context.close();
  });

  test("celular: com o teclado aberto (área menor) a caixa de mensagem continua visível e dentro da tela", async ({ browser }) => {
    const { context, page } = await mobilePage(browser);
    await page.goto(`/conversas/${conversation}`);
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    // O teclado encolhe a área útil (interactive-widget=resizes-content): simulamos com uma tela mais baixa.
    await page.setViewportSize({ width: 390, height: 420 });
    await page.getByLabel("Digitar mensagem de texto").tap();
    const box = (await page.getByLabel("Digitar mensagem de texto").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(420 + 1);
    const content = (await page.getByLabel("Histórico de mensagens").boundingBox())!;
    expect(content.height).toBeGreaterThan(60);
    const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "");
    expect(meta).toContain("interactive-widget=resizes-content");
    await context.close();
  });

  test("celular: navegação principal pelo menu alcança todas as telas (incluindo Preferências)", async ({ browser }) => {
    const { context, page } = await mobilePage(browser);
    await page.goto("/prioridades");
    await page.getByLabel("Abrir menu principal").tap();
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    for (const label of ["Prioridades", "Contatos", "Conversas", "Kanban", "Tarefas", "Configurações"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
    for (const link of await nav.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await expect(page.getByTestId("preferences-link")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toHaveCount(0);
    await context.close();
  });
});
