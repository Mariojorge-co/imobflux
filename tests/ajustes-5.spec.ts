import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Ajustes 5 — (B) folhas de toque fecham ao tocar fora, (C) campos com 16px no celular e Enviar visível, (D) seletor de emoji,
// (E) ajuda de atalhos só pelo botão, (F) "Rascunho:" na lista de conversas.

const JID_A = "5582988886101@s.whatsapp.net";
const JID_B = "5582988886102@s.whatsapp.net";
let convA = "";
let convB = "";

const composer = (page: Page) => page.getByLabel("Digitar mensagem de texto");

async function mobile(browser: Browser, height = 844) {
  const context = await browser.newContext({ viewport: { width: 390, height }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await loginAsDemoOwner(page);
  return { context, page };
}

async function openConversation(page: Page, id: string) {
  await page.goto(`/conversas/${id}`);
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

test.describe("Ajustes 5 — folhas, campos, emoji, ajuda e rascunho", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    convA = await ingestText(request, { jid: JID_A, text: "Bom dia, quero saber do apartamento", pushName: "Cliente Rascunho A" });
    convB = await ingestText(request, { jid: JID_B, text: "Outra conversa para comparar", pushName: "Cliente Rascunho B" });
  });

  test("aquecimento", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await mobile(browser);
    for (const route of ["/conversas", `/conversas/${convA}`, `/conversas/${convB}`, "/contatos", "/configuracoes/respostas-rapidas", "/preferencias"]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
    }
    await context.close();
  });

  // ─── B: folhas de toque ───────────────────────────────────────────────────────────────────────────────────────────
  test("B: folha do ⋯ — tocar no fundo escuro fecha, o foco volta ao botão; Esc fecha; arrastar a alça para baixo fecha", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await mobile(browser);
    await openConversation(page, convA);
    const more = page.getByTestId("conversation-more");
    const sheet = page.getByTestId("conversation-more-sheet");

    await more.tap();
    await expect(sheet).toBeVisible();
    // Toque no fundo escuro, bem acima da folha.
    await page.touchscreen.tap(195, 60);
    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));

    await more.tap();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(more).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));

    // Arrastar a alça para baixo fecha; um arrasto curto só devolve a folha ao lugar.
    await more.tap();
    await expect(sheet).toBeVisible();
    const handle = (await sheet.getByTestId("sheet-handle").boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 3 });
    await page.mouse.up();
    await expect(sheet).toBeVisible();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 140, { steps: 6 });
    await page.mouse.up();
    await expect(sheet).toHaveCount(0);
    await context.close();
  });

  test("B: folha do menu da mensagem fecha ao tocar fora; o menu ⋯ do prazo (menu flutuante) fecha ao tocar fora e devolve o foco", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await mobile(browser);
    await openConversation(page, convA);
    const bubble = page.getByLabel("Histórico de mensagens").locator("[data-message-id]").first();
    await bubble.getByTestId("message-menu-button").tap();
    const sheet = page.getByTestId("message-sheet");
    await expect(sheet).toBeVisible();
    await page.touchscreen.tap(195, 50);
    await expect(sheet).toHaveCount(0);

    const sla = page.getByTestId("sla-control");
    if (await sla.isVisible()) {
      await sla.tap();
      await expect(page.getByRole("menu")).toBeVisible();
      // Toque numa área sem ação nenhuma (antes dependia de um "mousedown" que o celular não gera).
      await page.touchscreen.tap(195, 400);
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(sla).toBeFocused();
    }
    await context.close();
  });

  // ─── C: 16px nos campos ───────────────────────────────────────────────────────────────────────────────────────────
  test("C: no celular todo campo de texto tem fonte de pelo menos 16px, o zoom de acessibilidade continua livre e o Enviar fica à vista", async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await mobile(browser);
    const small = async (name: string) => {
      const offenders = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("input, textarea, select")]
          .filter((el) => {
            const type = (el as HTMLInputElement).type;
            if (["checkbox", "radio", "range", "file", "color", "button", "submit", "reset", "image", "hidden"].includes(type)) return false;
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
          })
          .map((el) => ({ tag: el.tagName, label: el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.id, size: parseFloat(getComputedStyle(el).fontSize) }))
          .filter((item) => item.size < 16),
      );
      expect(offenders, `${name}: campos com menos de 16px`).toEqual([]);
    };

    await openConversation(page, convA);
    await small("conversa (mensagem)");
    await page.getByRole("button", { name: /Nota interna/ }).tap();
    await small("conversa (nota interna)");
    await page.getByRole("button", { name: /^Mensagem$/ }).first().tap().catch(() => undefined);
    await page.goto("/conversas");
    await small("lista de conversas (busca)");
    for (const route of ["/contatos", "/configuracoes/respostas-rapidas", "/preferencias", "/kanban", "/tarefas", "/configuracoes/equipe"]) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(500);
      await small(route);
    }

    // Edição de mensagem: o campo da caixa vira o de edição (mesmo textarea).
    await openConversation(page, convA);
    await expect(composer(page)).toBeVisible();
    expect(await composer(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

    // O zoom de acessibilidade não é desligado.
    const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "");
    expect(meta).not.toMatch(/maximum-scale|user-scalable/);
    expect(meta).toContain("interactive-widget=resizes-content");

    // Teclado aberto (área menor): campo e botão de enviar continuam dentro da tela.
    await page.setViewportSize({ width: 390, height: 420 });
    await composer(page).tap();
    await composer(page).fill("Mensagem para ver o botão");
    for (const locator of [composer(page), page.getByRole("button", { name: "Enviar mensagem" })]) {
      const box = (await locator.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(421);
    }
    await context.close();
  });

  // ─── D: emoji ─────────────────────────────────────────────────────────────────────────────────────────────────────
  test("D: seletor de emoji — busca, insere no cursor, recentes, Esc fecha só o painel; também na nota interna", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoOwner(page);
    await openConversation(page, convA);
    const button = page.getByTestId("emoji-insert-button");
    await expect(button).toBeVisible();

    await composer(page).fill("Olá  tudo bem");
    await composer(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 4));
    await button.click();
    const panel = page.getByTestId("emoji-insert-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("emoji-insert-recents")).toHaveCount(0);
    await panel.getByTestId("emoji-insert-search").fill("casa");
    await expect(panel.getByTestId("emoji-insert-results").locator('[data-emoji="🏠"]')).toBeVisible();
    await panel.locator('[data-emoji="🏠"]').first().click();
    await expect(composer(page)).toHaveValue("Olá 🏠 tudo bem");
    // O foco volta para a caixa, com o cursor logo depois do emoji.
    await expect(composer(page)).toBeFocused();
    expect(await composer(page).evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe("Olá 🏠".length);

    // O painel continua aberto para escolher mais de um; busca sem resultado.
    await expect(panel).toBeVisible();
    await page.getByTestId("emoji-insert-search").fill("xyzxyz");
    await expect(page.getByTestId("emoji-insert-empty")).toBeVisible();
    // Esc fecha só o painel (a conversa continua aberta).
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
    await expect(button).toBeFocused();

    // Recentes: o último escolhido aparece na frente, salvo por pessoa neste navegador.
    await button.click();
    await expect(page.getByTestId("emoji-insert-recents").locator('[data-emoji="🏠"]')).toBeVisible();
    await page.getByTestId("emoji-category-gestos").click();
    await page.getByTestId("emoji-insert-grid").locator('[data-emoji="👍"]').click();
    await expect(composer(page)).toContainText("");
    await expect(composer(page)).toHaveValue(/👍/);
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("imobflux:emoji-recentes:")));
    expect(keys).toHaveLength(1);
    expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key)!, keys[0]))).toEqual(["👍", "🏠"]);
    // Clicar fora fecha o painel.
    await page.getByLabel("Histórico de mensagens").click({ position: { x: 20, y: 20 } });
    await expect(panel).toHaveCount(0);

    // Nota interna: o mesmo botão insere na nota.
    await page.getByRole("button", { name: /Nota interna/ }).click();
    const note = page.getByLabel("Digitar nota interna (apenas CRM)");
    await note.fill("");
    await button.click();
    await page.getByTestId("emoji-insert-search").fill("chave");
    await page.locator('[data-emoji="🔑"]').first().click();
    await expect(note).toHaveValue("🔑");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("D: legenda de arquivo recebe emoji; no celular o botão fica escondido (vale o teclado de emoji do aparelho)", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoOwner(page);
    await openConversation(page, convA);
    await page.getByTestId("file-input").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    const caption = page.getByTestId("outgoing-caption");
    await caption.fill("Veja o imóvel");
    await page.getByTestId("caption-emoji-button").click();
    await page.getByTestId("emoji-insert-search").fill("casa");
    await page.locator('[data-emoji="🏠"]').first().click();
    await expect(caption).toHaveValue("Veja o imóvel🏠");

    const { context, page: phone } = await mobile(browser);
    await openConversation(phone, convA);
    await expect(phone.getByTestId("emoji-insert-button")).toBeHidden();
    await context.close();
  });

  // ─── E: ajuda de atalhos ──────────────────────────────────────────────────────────────────────────────────────────
  test("E: no celular a ajuda de atalhos abre pelo menu; a tecla ? não faz nada", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await mobile(browser);
    await page.goto("/conversas");
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
    await page.getByLabel("Abrir menu principal").tap();
    const entry = page.getByTestId("menu-shortcuts");
    expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await entry.tap();
    await expect(page.getByTestId("shortcuts-help")).toBeVisible();
    await expect(page.getByTestId("shortcuts-help")).toContainText("Alt + ↑ / ↓");
    await expect(page.getByTestId("shortcuts-help").locator("kbd", { hasText: /^[?]$/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
    await context.close();
  });

  // ─── F: rascunho na lista ─────────────────────────────────────────────────────────────────────────────────────────
  test("F: o cartão mostra 'Rascunho:' com o começo do texto, atualiza ao digitar, some ao apagar; não aparece na conversa aberta", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoOwner(page);
    await openConversation(page, convA);
    const cardA = page.locator(`#conv-card-${convA}`);
    await expect(cardA).toBeVisible();
    await expect(cardA.getByTestId("conversation-draft")).toHaveCount(0);

    await composer(page).fill("Preciso confirmar o valor do condomínio com o proprietário antes de responder");
    // Na conversa aberta o cartão não vira rascunho (o texto está na caixa; a prévia não pisca enquanto se digita).
    await page.waitForTimeout(700);
    await expect(cardA.getByTestId("conversation-draft")).toHaveCount(0);

    // Em outra conversa, o cartão da primeira mostra o rascunho.
    await page.locator(`#conv-card-${convB}`).click();
    await expect(page).toHaveURL(new RegExp(`/conversas/${convB}$`));
    const draftA = page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft");
    await expect(draftA).toContainText("Rascunho:");
    await expect(draftA).toContainText("Preciso confirmar o valor do condomínio");
    // Cartão da conversa aberta e o da outra sem rascunho continuam com a prévia normal.
    await expect(page.locator(`#conv-card-${convB}`).getByTestId("conversation-draft")).toHaveCount(0);

    // Voltar e apagar o texto: o rascunho some do cartão.
    await page.locator(`#conv-card-${convA}`).click();
    await expect(composer(page)).toHaveValue(/Preciso confirmar/);
    await composer(page).fill("");
    await page.locator(`#conv-card-${convB}`).click();
    await expect(page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft")).toHaveCount(0);
    await expect(page.locator(`#conv-card-${convA}`)).toContainText("Bom dia, quero saber do apartamento");
  });

  test("F: rascunho de resposta com citação (sem texto) também aparece; vale no celular e sobrevive a recarregar", async ({ browser }) => {
    test.setTimeout(120_000);
    const { context, page } = await mobile(browser);
    await openConversation(page, convA);
    const row = page.getByLabel("Histórico de mensagens").getByTestId("message-row").first();
    await row.getByTestId("message-menu-button").tap();
    await page.getByTestId("message-sheet").getByTestId("action-reply").tap();
    await expect(page.getByTestId("reply-card")).toBeVisible();

    // Volta para a lista (celular): o cartão mostra a quem a resposta se dirige.
    await page.goto("/conversas");
    const draft = page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft");
    await expect(draft).toContainText("Rascunho:");
    await expect(draft).toContainText("respondendo a");

    // Com texto digitado junto da citação, o texto vem primeiro.
    await openConversation(page, convA);
    await expect(page.getByTestId("reply-card")).toBeVisible();
    await composer(page).fill("Vou verificar e retorno");
    await page.goto("/conversas");
    await expect(page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft")).toContainText("Vou verificar e retorno");
    // Recarregar mantém (fica só nesta aba do navegador).
    await page.reload();
    await expect(page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft")).toContainText("Vou verificar e retorno");

    // Cancelar a citação e apagar o texto limpa o rascunho.
    await openConversation(page, convA);
    await page.getByTestId("reply-cancel").tap();
    await composer(page).fill("");
    await page.goto("/conversas");
    await expect(page.locator(`#conv-card-${convA}`).getByTestId("conversation-draft")).toHaveCount(0);
    await context.close();
  });
});
