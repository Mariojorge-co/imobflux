import zlib from "node:zlib";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Ajustes 6 — (A) teclado do iPhone (área visível), (B) cabeçalho da conversa no celular, (C) auditoria das sobreposições,
// (D) imagens e vídeos em branco, (E) iPhone: texto honesto e instalação como app (PWA).
// Não existe iPhone aqui: o Chromium com toque emula o tamanho e o toque; o teclado do iOS é simulado trocando o
// window.visualViewport (o que o iOS faz de verdade). O que só um iPhone real confirma está em docs/RELATORIO_AJUSTES_6.md.

const JID = "5582988886601@s.whatsapp.net";
const FAKE_PORT = 3099;
let conversation = "";
let fake: FakeEvolution;

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** PNG de verdade (cor sólida) para a miniatura ter tamanho visível. */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x66)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const mp4 = (size: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), Buffer.alloc(size - 12, 2)]);

/** Simula o iOS: window.visualViewport controlável (height/offsetTop/scale); sem override, acompanha a janela. */
const VISUAL_VIEWPORT_STUB = () => {
  const state = { override: null as number | null, offsetTop: 0, scale: 1 };
  const target = new EventTarget();
  Object.defineProperties(target, {
    height: { get: () => state.override ?? window.innerHeight },
    width: { get: () => window.innerWidth },
    offsetTop: { get: () => state.offsetTop },
    offsetLeft: { value: 0 },
    pageTop: { get: () => state.offsetTop },
    pageLeft: { value: 0 },
    scale: { get: () => state.scale },
  });
  Object.defineProperty(window, "visualViewport", { value: target, configurable: true });
  (window as unknown as { __vv: unknown }).__vv = {
    set(next: { override?: number | null; offsetTop?: number; scale?: number }) {
      if ("override" in next) state.override = next.override ?? null;
      if ("scale" in next) state.scale = next.scale ?? 1;
      if ("offsetTop" in next) state.offsetTop = next.offsetTop ?? 0;
      target.dispatchEvent(new Event("resize"));
      target.dispatchEvent(new Event("scroll"));
    },
  };
};

async function phone(browser: Browser, width = 390, height = 844, stub = false) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  if (stub) await page.addInitScript(VISUAL_VIEWPORT_STUB);
  await loginAsDemoOwner(page);
  return { context, page };
}

async function openConversation(page: Page, id = conversation) {
  await page.goto(`/conversas/${id}`);
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

const setKeyboard = (page: Page, next: { override?: number | null; offsetTop?: number; scale?: number }) =>
  page.evaluate((value) => (window as unknown as { __vv: { set: (n: unknown) => void } }).__vv.set(value), next);

const rectOf = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((element) => {
    const { top, bottom, left, right, height } = element.getBoundingClientRect();
    return { top, bottom, left, right, height };
  });

test.describe("Ajustes 6", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Primeira mensagem do cliente", pushName: "Cliente Ajustes Seis" });
    for (let index = 1; index <= 24; index += 1) {
      await ingestText(request, { jid: JID, text: `Mensagem ${index} para dar rolagem à conversa`, pushName: "Cliente Ajustes Seis" });
    }
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test("aquecimento", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await phone(browser);
    for (const route of ["/conversas", `/conversas/${conversation}`, "/preferencias", "/configuracoes/equipe", "/kanban"]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
    }
    await context.close();
  });

  // ─── B: cabeçalho da conversa ───────────────────────────────────────────────────────────────────────────────────────
  for (const width of [360, 390, 430, 768]) {
    test(`B: cabeçalho sem sobreposição e sem rolagem lateral em ${width}px`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { context, page } = await phone(browser, width, 844);
      await openConversation(page);
      const result = await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>('[data-testid="conversation-header"]')!;
        const visible = (element: Element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 2 && rect.height > 2; // ignora o texto só-para-leitor-de-tela (1px)
        };
        const atoms = [...header.querySelectorAll<HTMLElement>("a, button, select, p, span")]
          .filter((element) => visible(element) && (element.matches("a, button, select, p") || element.children.length === 0))
          .map((element) => ({ element, rect: element.getBoundingClientRect(), label: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 24) ?? "" }));
        const overlaps: string[] = [];
        for (let i = 0; i < atoms.length; i += 1) {
          for (let j = i + 1; j < atoms.length; j += 1) {
            const a = atoms[i];
            const b = atoms[j];
            if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
            const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
            const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            if (w > 0.5 && h > 0.5) overlaps.push(`${a.label} x ${b.label}`);
          }
        }
        const outside = atoms.filter((atom) => atom.rect.left < -0.5 || atom.rect.right > window.innerWidth + 0.5).map((atom) => atom.label);
        const controls = atoms.filter((atom) => atom.element.matches("a, button, select")).map((atom) => atom.label);
        const phoneLine = [...header.querySelectorAll<HTMLElement>("p")].find((element) => /^[+]?[0-9]/.test(element.textContent ?? ""));
        return {
          phoneCut: phoneLine ? phoneLine.scrollWidth - phoneLine.clientWidth : 0,
          overlaps,
          outside,
          controls,
          headerHeight: header.getBoundingClientRect().height,
          scrollOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(result.overlaps, `sobreposições em ${width}px`).toEqual([]);
      expect(result.outside).toEqual([]);
      // O telefone aparece inteiro (o prazo no cabeçalho do celular é compacto e não o espreme).
      expect(result.phoneCut, "telefone cortado").toBeLessThanOrEqual(1);
      expect(result.scrollOverflow).toBeLessThanOrEqual(0);
      if (width < 768) {
        // Uma linha limpa: voltar, nome/telefone, lupa e ⋯. Nada de Atribuir, Oportunidade, e-mail ou fixar no cabeçalho.
        expect(result.headerHeight).toBeLessThanOrEqual(64);
        expect(result.controls).toEqual(["Voltar para a lista de conversas", "Buscar nesta conversa", "Mais ações da conversa"]);
      }
      await context.close();
    });
  }

  test("B: todas as ações do cabeçalho estão no ⋯, cada uma com 44px de toque, e funcionam", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await phone(browser);
    await openConversation(page);
    await page.getByTestId("conversation-more").tap();
    const sheet = page.getByTestId("conversation-more-sheet");
    await expect(sheet).toBeVisible();

    for (const id of ["more-info", "more-opportunity", "more-sla-active", "more-sla-paused", "more-sla-disabled", "more-unread", "more-pin", "more-archive", "more-hidden"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, `${id} altura`).toBeGreaterThanOrEqual(44);
    }
    const assign = sheet.getByLabel("Atribuir um responsável à conversa");
    await expect(assign).toBeVisible();
    expect((await assign.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // O "Atribuir a…" da folha atribui de verdade.
    const options = await assign.locator("option").evaluateAll((all) => all.map((option) => (option as HTMLOptionElement).value).filter(Boolean));
    expect(options.length).toBeGreaterThan(0);
    await assign.selectOption(options[0]);
    await expect(sheet.getByTestId("assignee-chip")).toHaveCount(1, { timeout: 15_000 });
    const remove = sheet.getByRole("button", { name: /dos responsáveis/ });
    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await remove.tap();
    await expect(sheet.getByTestId("assignee-chip")).toHaveCount(0, { timeout: 15_000 });

    // Prazo pela folha: pausar e conferir a marca.
    await page.getByTestId("more-sla-paused").tap();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("conversation-more").tap();
    await expect(page.getByTestId("more-sla-paused")).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await page.getByTestId("more-sla-active").tap();
    await expect(sheet).toHaveCount(0);

    // Informações do cliente abre o painel e o foco volta ao ⋯ ao fechar.
    await page.getByTestId("conversation-more").tap();
    await page.getByTestId("more-info").tap();
    const info = page.getByRole("dialog", { name: /Dados do cliente|Informações|Contexto/i });
    await expect(page.locator('[role="dialog"][aria-modal="true"]').first()).toBeVisible();
    // O painel entrega o foco ao botão de fechar quando está pronto; só então o Esc vale.
    await expect(page.locator('aside[role="dialog"] button').first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
    await expect(page.getByTestId("conversation-more")).toBeFocused();
    void info;

    // Oportunidade: criar abre o formulário.
    await page.getByTestId("conversation-more").tap();
    await page.getByTestId("more-opportunity").tap();
    await expect(page.getByRole("dialog").filter({ hasText: "Criar Oportunidade" })).toBeVisible();
    await page.keyboard.press("Escape");
    await context.close();
  });

  test("B: no computador o cabeçalho continua como era (ações diretas, sem ⋯)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsDemoOwner(page);
    await openConversation(page);
    await expect(page.getByTestId("conversation-more")).toBeHidden();
    await expect(page.getByTestId("conversation-pin-toggle")).toBeVisible();
    await expect(page.getByLabel("Atribuir um responsável à conversa")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir dados do cliente" })).toBeVisible();
  });

  // ─── A: teclado do iPhone ───────────────────────────────────────────────────────────────────────────────────────────
  test("A: com o teclado aberto a conversa ocupa só a área visível, a caixa fica colada no teclado e a última mensagem aparece", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await phone(browser, 390, 844, true);
    await openConversation(page);
    const log = page.getByLabel("Histórico de mensagens");
    await expect(log).toBeVisible();
    // A conversa abre no fim.
    await expect.poll(() => log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(8);

    const tabsBefore = await page.locator(".composer-tabs button").first().evaluate((element) => element.getBoundingClientRect().height);
    expect(tabsBefore).toBeGreaterThanOrEqual(44);

    await page.getByLabel("Digitar mensagem de texto").focus();
    await setKeyboard(page, { override: 500, offsetTop: 0 });
    await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "true");
    const frame = await rectOf(page, "conversations-frame");
    expect(Math.round(frame.top)).toBe(0);
    expect(Math.round(frame.height)).toBe(500);
    const composer = await rectOf(page, "message-composer");
    // Caixa logo acima do teclado: o fundo dela é o fundo da área visível (sem espaço vazio no meio).
    expect(composer.bottom).toBeLessThanOrEqual(501);
    expect(composer.bottom).toBeGreaterThanOrEqual(497);
    // A lista rolou junto e a última mensagem continua à vista, acima da caixa.
    await expect.poll(() => log.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(8);
    const lastBottom = await log.locator("> *").last().evaluate((element) => element.getBoundingClientRect().bottom);
    expect(lastBottom).toBeLessThanOrEqual(composer.top + 1);
    // Faixa de abas compacta.
    const tabsOpen = await page.locator(".composer-tabs button").first().evaluate((element) => element.getBoundingClientRect().height);
    expect(tabsOpen).toBeLessThanOrEqual(33);
    // O iOS rola a página para mostrar o campo: a moldura acompanha o deslocamento da área visível.
    await setKeyboard(page, { offsetTop: 36 });
    await expect.poll(async () => Math.round((await rectOf(page, "conversations-frame")).top)).toBe(36);
    await setKeyboard(page, { offsetTop: 0 });

    // Fechar o teclado: tudo volta ao normal.
    await page.getByLabel("Digitar mensagem de texto").blur();
    await setKeyboard(page, { override: null });
    await expect(page.locator("html")).not.toHaveAttribute("data-keyboard-open", "true");
    // Sem teclado a moldura volta ao tamanho de CSS (Ajustes 7: fixa até a borda de baixo, sem altura/posição em linha).
    expect(await page.getByTestId("conversations-frame").evaluate((element) => element.getAttribute("style") ?? "")).toBe("");
    const closedFrame = await rectOf(page, "conversations-frame");
    expect(Math.round(closedFrame.height)).toBe(844 - 64);
    expect((await page.locator(".composer-tabs button").first().evaluate((element) => element.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
    await context.close();
  });

  test("A: girar o aparelho (paisagem) e o Android (layout que já encolhe) não reservam o teclado duas vezes", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await phone(browser, 390, 844, true);
    await openConversation(page);
    const box = page.getByLabel("Digitar mensagem de texto");
    await box.focus();

    // Android com interactive-widget=resizes-content: o layout encolhe junto, a área visível é a própria janela.
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(page.locator("html")).not.toHaveAttribute("data-keyboard-open", "true");
    await expect.poll(async () => Math.round((await rectOf(page, "message-composer")).bottom)).toBeGreaterThanOrEqual(496);
    expect((await rectOf(page, "message-composer")).bottom).toBeLessThanOrEqual(501);

    // Paisagem, sem teclado: a moldura é a altura da janela menos a barra superior.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(async () => Math.round((await rectOf(page, "conversations-frame")).height)).toBe(390 - 64);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Paisagem com teclado (o iOS cobre mais da metade da tela).
    await page.setViewportSize({ width: 844, height: 390 });
    await box.focus();
    await setKeyboard(page, { override: 190, offsetTop: 0 });
    await expect(page.locator("html")).toHaveAttribute("data-keyboard-open", "true");
    expect(Math.round((await rectOf(page, "conversations-frame")).height)).toBe(190);
    // Área minúscula: o cabeçalho se esconde para a caixa caber inteira acima do teclado.
    await expect(page.getByTestId("conversation-header")).toBeHidden();
    expect((await rectOf(page, "message-composer")).bottom).toBeLessThanOrEqual(191);
    await page.getByLabel("Digitar mensagem de texto").blur();
    await setKeyboard(page, { override: null });
    await expect(page.getByTestId("conversation-header")).toBeVisible();
    await context.close();
  });

  test("A: zoom de pinça não é confundido com teclado", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser, 390, 844, true);
    await openConversation(page);
    await page.getByLabel("Digitar mensagem de texto").focus();
    await setKeyboard(page, { override: 400, scale: 2 });
    await expect(page.locator("html")).not.toHaveAttribute("data-keyboard-open", "true");
    await context.close();
  });

  // ─── C: menu sanduíche e auditoria das sobreposições ────────────────────────────────────────────────────────────────
  test("C: menu ☰ fecha tocando no fundo escuro, com Esc e ao escolher uma tela; o foco volta ao ☰", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await phone(browser);
    await page.goto("/conversas");
    await expect(page.getByRole("button", { name: "Abrir menu principal" })).toBeVisible();
    const hamburger = () => page.getByRole("button", { name: /menu principal/ }).first();
    const nav = page.locator("#mobile-navigation");

    await page.getByRole("button", { name: "Abrir menu principal" }).tap();
    await expect(nav).toBeVisible();
    await expect(page.getByTestId("nav-backdrop")).toBeVisible();
    await page.touchscreen.tap(195, 700);
    await expect(nav).toHaveCount(0);
    await expect(hamburger()).toBeFocused();

    await page.getByRole("button", { name: "Abrir menu principal" }).tap();
    await expect(nav).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toHaveCount(0);
    await expect(hamburger()).toBeFocused();

    await page.getByRole("button", { name: "Abrir menu principal" }).tap();
    await nav.getByRole("link", { name: /Kanban/i }).first().tap();
    await expect(page).toHaveURL(/\/kanban/);
    await expect(nav).toHaveCount(0);
    await expect(hamburger()).toBeFocused();
    await context.close();
  });

  test("C: auditoria — cada sobreposição do celular fecha tocando fora e com Esc, e devolve o foco", async ({ browser }) => {
    test.setTimeout(300_000);
    const { context, page } = await phone(browser);
    await openConversation(page);
    const outsideTap = (x: number, y: number) => page.touchscreen.tap(x, y);

    type Case = { name: string; open: () => Promise<void>; opened: () => Promise<void>; closed: () => Promise<void>; focus: () => ReturnType<Page["locator"]> | null; tapOutside: () => Promise<void> };
    const cases: Case[] = [
      {
        name: "folha ⋯ da conversa",
        open: () => page.getByTestId("conversation-more").tap(),
        opened: () => expect(page.getByTestId("conversation-more-sheet")).toBeVisible(),
        closed: () => expect(page.getByTestId("conversation-more-sheet")).toHaveCount(0),
        focus: () => page.getByTestId("conversation-more"),
        tapOutside: () => outsideTap(195, 60),
      },
      {
        name: "painel de respostas rápidas",
        open: () => page.getByTestId("quick-replies-button").tap(),
        opened: () => expect(page.getByTestId("quick-replies-panel")).toBeVisible(),
        closed: () => expect(page.getByTestId("quick-replies-panel")).toHaveCount(0),
        focus: () => page.getByTestId("quick-replies-button"),
        tapOutside: () => outsideTap(195, 30),
      },
      {
        name: "busca global (diálogo)",
        open: () => page.getByTestId("global-search-button").tap(),
        opened: () => expect(page.getByTestId("global-search")).toBeVisible(),
        closed: () => expect(page.getByTestId("global-search")).toBeHidden(),
        focus: () => page.getByTestId("global-search-button"),
        tapOutside: () => outsideTap(4, 4),
      },
    ];

    for (const entry of cases) {
      await entry.open();
      await entry.opened();
      await entry.tapOutside();
      await entry.closed();
      const target = entry.focus();
      if (target) await expect(target, `${entry.name}: foco volta ao abrir por toque fora`).toBeFocused();

      await entry.open();
      await entry.opened();
      await page.keyboard.press("Escape");
      await entry.closed();
      if (target) await expect(target, `${entry.name}: foco volta com Esc`).toBeFocused();
    }

    // Ajuda de atalhos, aberta pelo menu ☰ (o foco volta ao ☰).
    const hamburger = page.getByRole("button", { name: /menu principal/ }).first();
    await page.getByRole("button", { name: "Abrir menu principal" }).tap();
    await page.getByTestId("menu-shortcuts").tap();
    const help = page.getByRole("dialog", { name: /atalhos/i });
    await expect(help).toBeVisible();
    await outsideTap(4, 4);
    await expect(help).toBeHidden();
    await expect(hamburger).toBeFocused();

    // Painel de informações do cliente (gaveta) pela folha ⋯: toque no fundo, Esc e foco de volta ao ⋯.
    for (const how of ["fundo", "esc"] as const) {
      await page.getByTestId("conversation-more").tap();
      await page.getByTestId("more-info").tap();
      const drawer = page.locator('aside[role="dialog"]');
      await expect(drawer).toBeVisible();
      await expect(drawer.locator("button").first()).toBeFocused();
      if (how === "fundo") await outsideTap(8, 400);
      else await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(page.getByTestId("conversation-more")).toBeFocused();
    }
    await context.close();
  });

  test("C: auditoria no computador — prazo, emoji e ampliação de imagem fecham fora e com Esc, e devolvem o foco", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsDemoOwner(page);
    await openConversation(page);

    const sla = page.getByTestId("sla-control");
    await sla.click();
    await expect(page.getByTestId("sla-option-paused")).toBeVisible();
    await page.mouse.click(700, 400);
    await expect(page.getByTestId("sla-option-paused")).toHaveCount(0);
    await expect(sla).toBeFocused();
    await sla.click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("sla-option-paused")).toHaveCount(0);
    await expect(sla).toBeFocused();

    const emoji = page.getByTestId("emoji-insert-button");
    await emoji.click();
    await expect(page.getByTestId("emoji-insert-panel")).toBeVisible();
    await page.mouse.click(700, 300);
    await expect(page.getByTestId("emoji-insert-panel")).toHaveCount(0);
    await expect(emoji).toBeFocused();
    await emoji.click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("emoji-insert-panel")).toHaveCount(0);
    await expect(emoji).toBeFocused();

    // Diálogo do formulário da equipe (dialog nativo): fora fecha.
    await page.goto("/configuracoes/equipe");
    await page.getByRole("button", { name: "Adicionar funcionário" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(dialog).toHaveCount(0);
  });

  // ─── D: imagens e vídeos ────────────────────────────────────────────────────────────────────────────────────────────
  test("D: foto e vídeo enviados aparecem; foto que carrega ANTES da hidratação não fica no quadrado vazio", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await phone(browser);
    await openConversation(page);
    await page.getByTestId("file-input").setInputFiles([
      { name: "fachada.png", mimeType: "image/png", buffer: png(160, 120) },
      { name: "visita.mp4", mimeType: "video/mp4", buffer: mp4(3_000) },
    ]);
    await expect(page.getByTestId("outgoing-item")).toHaveCount(2);
    await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(2, { timeout: 60_000 });
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => fake.requests.filter((request) => request.path.includes("/message/sendMedia/")).length, { timeout: 60_000 }).toBe(2);
    await expect.poll(() => Number(queryLocalSql(`select count(*) from public.attachments a join public.messages m on m.id = a.message_id where m.conversation_id = '${conversation}' and m.direction = 'outgoing';`))).toBe(2);

    // Atrasa os scripts da página: a imagem termina de carregar antes de o React hidratar (o caso do iPhone com a rede boa).
    let hold = true;
    // Só os .js (os .css bloqueiam o carregamento da página e mudariam o que se quer medir).
    await page.route((url) => url.pathname.includes("/_next/static/chunks/") && url.pathname.endsWith(".js"), async (route) => {
      while (hold) await new Promise((resolve) => setTimeout(resolve, 100));
      await route.continue().catch(() => undefined);
    });
    await page.goto(`/conversas/${conversation}`, { waitUntil: "commit" });
    const image = page.locator('img[alt="fachada.png"]');
    await expect(image).toBeAttached({ timeout: 30_000 });
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0), { timeout: 30_000 }).toBe(true);
    hold = false;
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible({ timeout: 60_000 });
    // Depois da hidratação a miniatura está visível (sem o quadrado pulsante e sem opacity-0).
    await expect(image).not.toHaveClass(/opacity-0/);
    await expect(page.getByTestId("image-thumb")).not.toHaveClass(/animate-pulse/);

    // Vídeo: o quadro inicial é pedido (#t=0.001) e os atributos do iOS estão presentes.
    const video = page.getByTestId("video-thumb").locator("video");
    await expect(video).toHaveAttribute("src", /\/api\/attachments\/[0-9a-f-]+#t=0\.001$/);
    await expect(video).toHaveAttribute("preload", "metadata");
    expect(await video.evaluate((element: HTMLVideoElement) => element.playsInline && element.muted)).toBe(true);
    await context.close();
  });

  test("D: imagem que falha mostra aviso claro com 'Tentar de novo', e a nova tentativa carrega", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await phone(browser);
    let failing = true;
    await page.route("**/api/attachments/**", async (route) => {
      if (failing && route.request().resourceType() === "image") await route.abort("failed");
      else await route.continue();
    });
    await openConversation(page);
    const unavailable = page.getByTestId("attachment-unavailable").first();
    await expect(unavailable).toBeVisible({ timeout: 30_000 });
    await expect(unavailable).toContainText("Não foi possível exibir o arquivo");
    failing = false;
    await unavailable.getByTestId("attachment-reload").tap();
    await expect(page.getByTestId("image-thumb").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.locator('img[alt="fachada.png"]').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await context.close();
  });

  test("D: a rota de anexos aceita Range (exigência do vídeo no iOS) e devolve o tipo certo", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await phone(browser);
    const id = queryLocalSql(`select a.id from public.attachments a join public.messages m on m.id = a.message_id where m.conversation_id = '${conversation}' and a.mime_type = 'video/mp4' limit 1;`).trim();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const response = await page.request.get(`/api/attachments/${id}`, { headers: { Range: "bytes=0-1" } });
    expect(response.status()).toBe(206);
    expect(response.headers()["accept-ranges"]).toBe("bytes");
    expect(response.headers()["content-range"]).toMatch(/^bytes 0-1\/\d+$/);
    expect(response.headers()["content-type"]).toBe("video/mp4");
    await context.close();
  });

  // ─── E: iPhone, avisos honestos e instalação ───────────────────────────────────────────────────────────────────────
  test("E: no iPhone, Preferências diz a verdade sobre avisos e ensina a instalar; o teste do aviso funciona", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    const notice = page.getByTestId("ios-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("não funcionam");
    await expect(notice).toContainText("só com a página aberta e em primeiro plano");
    await expect(notice).toContainText("Web Push");
    const help = page.getByTestId("install-help");
    await expect(help).toContainText("Compartilhar");
    await expect(help).toContainText("Adicionar à Tela de Início");
    await expect(help).toContainText("Instalar não liga os avisos");
    await expect(page.getByTestId("notif-device-summary")).toContainText("não chega aviso do sistema nem toca som em segundo plano");
    await page.getByTestId("notif-test").tap();
    await expect(page.getByTestId("notif-test-result")).toContainText("Teste das");
    await context.close();
  });

  test("E: no computador o aviso do iPhone não aparece e a instalação continua explicada", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await expect(page.getByTestId("notification-diagnostics")).toBeVisible();
    await expect(page.getByTestId("ios-notice")).toHaveCount(0);
    await expect(page.getByTestId("install-help")).toBeVisible();
  });

  test("E: PWA — manifest, ícones, apple-touch-icon, meta do iOS e service worker sem atrapalhar", async ({ page, request }) => {
    test.setTimeout(120_000);
    // Sem login: o manifest é público (o proxy de sessão não o intercepta).
    const manifestResponse = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
    expect(manifestResponse.status()).toBe(200);
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({ name: "ImobFlux", short_name: "ImobFlux", display: "standalone", start_url: "/conversas", lang: "pt-BR" });
    const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    expect(icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")).toBe(true);
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of icons) {
      const file = await request.get(icon.src, { maxRedirects: 0 });
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"]).toContain("image/png");
    }

    await loginAsDemoOwner(page);
    await page.goto("/conversas");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-icon/);
    const apple = await request.get((await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"))!, { maxRedirects: 0 });
    expect(apple.status()).toBe(200);
    expect(apple.headers()["content-type"]).toContain("image/png");
    await expect(page.locator('meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]').first()).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "ImobFlux");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    // O zoom de acessibilidade continua ligado.
    const viewport = (await page.locator('meta[name="viewport"]').getAttribute("content")) ?? "";
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);

    // O service worker de avisos não tem "fetch": não intercepta nem armazena nada das páginas.
    const worker = await request.get("/sw-avisos.js", { maxRedirects: 0 });
    expect(worker.status()).toBe(200);
    const source = await worker.text();
    expect(source).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(source).not.toMatch(/caches\./);
  });

  test("E: áreas seguras — topo, laterais e base respeitam env(safe-area-inset-*)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemoOwner(page);
    await openConversation(page);
    const css = await page.evaluate(() => {
      const sheets = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText);
        } catch {
          return [];
        }
      });
      return sheets.join("\n");
    });
    expect(css).toContain("safe-area-inset-top");
    expect(css).toContain("safe-area-inset-bottom");
    expect(css).toContain("safe-area-inset-left");
    expect(css).toContain("safe-area-inset-right");
  });
});
