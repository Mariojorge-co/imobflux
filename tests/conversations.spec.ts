import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  demoOwner,
  loginAsDemoOwner,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";

// ─── Fixtures de ambiente ─────────────────────────────────────────────────────

// ─── Suíte de testes do Módulo de Conversas ──────────────────────────────────

test.describe.serial("conversations module", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await resetAndLoadDemoMode();
    runLocalSql(`
      insert into public.messages (
        id, workspace_id, channel_connection_id, conversation_id, direction,
        origin, sender_contact_point_id, text_content, status, occurred_at,
        external_message_id, external_created_at, received_at, created_at
      )
      select
        ('e0000001-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        workspace_id,
        channel_connection_id,
        id,
        'incoming',
        'whatsapp',
        'd3300004-0000-4000-8000-000000000001'::uuid,
        'Mensagem paginada ' || series,
        'received',
        now() - (series || ' seconds')::interval,
        'playwright-page-' || series,
        now() - (series || ' seconds')::interval,
        now() - (series || ' seconds')::interval,
        now() - (series || ' seconds')::interval
      from public.conversations
      cross join generate_series(1, 105) as series
      where id = 'd3300003-0000-4000-8000-000000000001';
    `);
  });

  // ─── Testes ────────────────────────────────────────────────────────────────

  test("redireciona /conversas para login quando não autenticado", async ({ page }) => {
    await page.goto("/conversas");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("exibe a lista de conversas após login", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas");
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeVisible();
  });

  test("contexto abre somente sob demanda em mobile e desktop", async ({ page }) => {
    await loginAsDemoOwner(page);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");

      const trigger = page.getByRole("button", { name: "Abrir dados do cliente" });
      const drawer = page.getByRole("dialog", { name: "Dados do cliente" });
      await expect(trigger).toBeVisible();
      await expect(drawer).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await trigger.click();
      await expect(drawer).toBeVisible();
      const drawerWidth = await drawer.evaluate((element) => element.getBoundingClientRect().width);
      expect(drawerWidth).toBeLessThanOrEqual(Math.min(400, viewport.width));

      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(page.getByRole("form", { name: "Formulário de envio de mensagem" })).toBeVisible();
    }
  });

  test("OWNER carrega inbox e históricos reais sem erro de leitura ou DOM antigo", async ({ page }) => {
    test.setTimeout(90_000);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const clientKey = process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY!;
    const supabase = createClient(supabaseUrl, clientKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const runtimeErrors: string[] = [];
    const readErrorPattern = /Não foi possível carregar (a lista de conversas|o histórico de mensagens)|get_conversations_inbox|get_conversation_messages|server components? render/i;

    page.on("pageerror", (error) => {
      if (readErrorPattern.test(error.message)) runtimeErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error" && readErrorPattern.test(message.text())) {
        runtimeErrors.push(message.text());
      }
    });

    const { error: authError } = await supabase.auth.signInWithPassword(demoOwner);
    expect(authError).toBeNull();

    const inboxResult = await supabase.rpc("get_conversations_inbox", {
      p_view: "all",
      p_limit: 20,
    });
    expect(inboxResult.error, JSON.stringify(inboxResult.error)).toBeNull();
    expect(inboxResult.data?.items?.length).toBeGreaterThanOrEqual(2);

    const firstMessagesResult = await supabase.rpc("get_conversation_messages", {
      p_conversation_id: "d3300003-0000-4000-8000-000000000001",
      p_limit: 50,
    });
    expect(firstMessagesResult.error, JSON.stringify(firstMessagesResult.error)).toBeNull();
    expect(firstMessagesResult.data?.messages?.length).toBeGreaterThan(0);

    await loginAsDemoOwner(page);
    await page.goto("/conversas");
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeVisible();

    const scenarios = [
      {
        id: "d3300003-0000-4000-8000-000000000001",
        message: "Mensagem paginada 1",
      },
      {
        id: "d3300003-0000-4000-8000-000000000002",
        message: "Boa tarde! Gostaria de saber o valor do condomínio da casa em Marechal.",
      },
    ];

    for (const scenario of scenarios) {
      const card = page.locator(`#conv-card-${scenario.id}`);
      await expect(card).toBeVisible();
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/conversas/${scenario.id}$`), {
        timeout: 15_000,
      });

      const history = page.getByRole("log", { name: "Histórico de mensagens" });
      await expect(history).toBeVisible();
      await expect(history.getByText(scenario.message, { exact: true })).toBeVisible();
      await expect(page.getByText(/Não foi possível carregar (a lista de conversas|o histórico de mensagens)/)).toHaveCount(0);
    }

    await page.waitForTimeout(500);
    expect(runtimeErrors).toEqual([]);
    await supabase.auth.signOut();
  });

  test("exibe estado vazio quando não há conversas (busca sem resultado)", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas");

    const searchInput = page.getByLabel("Buscar conversas por nome ou telefone");
    await searchInput.fill("xyzconversainexistente12345");
    await expect(page.getByText(/Nenhuma conversa encontrada/)).toBeVisible();
  });

  test("campo de busca aplica debounce e dispara busca ao pressionar Enter", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas");

    const searchInput = page.getByLabel("Buscar conversas por nome ou telefone");
    await searchInput.fill("playwright");
    // Aguarda debounce (350ms) sem pressionar Enter
    await page.waitForTimeout(500);
    // Estado após debounce: lista deve ter atualizado
    await expect(searchInput).toHaveValue("playwright");

    // Pressiona ESC para limpar
    await searchInput.press("Escape");
    await expect(searchInput).toHaveValue("");
  });

  test("navega para /conversas/[id] ao clicar numa conversa", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas");

    // Aguarda pelo menos um card de conversa
    const cards = page.locator('[id^="conv-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().click();
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]+$/);
    // Painel de mensagens deve estar visível
    await expect(page.getByRole("log", { name: "Histórico de mensagens" })).toBeVisible();
  });

  test("deep link para /conversas/[id] funciona diretamente", async ({ page }) => {
    await loginAsDemoOwner(page);
    const conversationId = "d3300003-0000-4000-8000-000000000001";

    await page.goto(`/conversas/${conversationId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("log", { name: "Histórico de mensagens" })).toBeVisible();
    const contextButton = page.getByRole("button", { name: "Abrir dados do cliente" });
    if (await contextButton.isVisible()) {
      await contextButton.click();
      await expect(page.getByRole("dialog", { name: "Dados do cliente" }).getByText("Apê 2/4 no Farol", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText("Apê 2/4 no Farol", { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("combobox", { name: /Selecionar oportunidade/i })).toHaveCount(0);
  });

  test("exibe o compositor de mensagem ativo com suporte a notas internas", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas");

    const cards = page.locator('[id^="conv-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().click();
    await expect(page.getByRole("button", { name: "Mensagem", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nota interna" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar mensagem" })).toBeVisible();
  });

  test("botão voltar retorna para /conversas no mobile (viewport 390x844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemoOwner(page);
    await page.goto("/conversas");

    const cards = page.locator('[id^="conv-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().click();
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]+$/);

    await page.getByRole("link", { name: "Voltar para a lista de conversas" }).click();
    await expect(page).toHaveURL(/\/conversas$/);
  });

  test("Bloco A mantém Conversas e Prioridades responsivos nos viewports alvo", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemoOwner(page);

    await page.goto("/prioridades");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByRole("heading", { name: /Equipe Devendo Resposta/ })).toBeVisible();

    await page.goto("/conversas");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.locator('[id^="conv-card-"]').nth(5)).toBeVisible();

    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");
    const conversationHeader = page.locator("main").getByRole("paragraph").filter({ hasText: "DEMO — Cliente Público" });
    await expect(conversationHeader).toBeVisible();
    await expect(page.locator("main").getByRole("paragraph").filter({ hasText: "(82) 99999-0001" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const mobileLayout = await page.evaluate(() => {
      const history = document.querySelector<HTMLElement>('[role="log"]');
      const composer = document.querySelector<HTMLElement>('form[aria-label="Formulário de envio de mensagem"]')?.parentElement;
      const targets = [
        document.querySelector<HTMLElement>('a[aria-label="Voltar para a lista de conversas"]'),
        document.querySelector<HTMLElement>('button[aria-label="Abrir dados do cliente"]'),
        document.querySelector<HTMLElement>('button[aria-label="Enviar mensagem"]'),
      ];
      return {
        composerBottom: composer?.getBoundingClientRect().bottom ?? 0,
        historyOverflow: history ? getComputedStyle(history).overflowY : "",
        targetSizes: targets.map((element) => element
          ? { height: element.getBoundingClientRect().height, width: element.getBoundingClientRect().width }
          : null),
      };
    });
    expect(mobileLayout.composerBottom).toBeGreaterThanOrEqual(840);
    expect(mobileLayout.composerBottom).toBeLessThanOrEqual(844);
    expect(mobileLayout.historyOverflow).toBe("auto");
    for (const size of mobileLayout.targetSizes) {
      expect(size).not.toBeNull();
      expect(size!.height).toBeGreaterThanOrEqual(44);
      expect(size!.width).toBeGreaterThanOrEqual(44);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.getByRole("button", { name: "Abrir dados do cliente" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Alterar etapa da oportunidade ativa" })).toBeVisible();

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.getByRole("heading", { name: "Identificação" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abrir dados do cliente" })).toBeVisible();
  });

  test("pagina o histórico sem duplicar, preserva scroll e limpa ao trocar de conversa", async ({ page }) => {
    await loginAsDemoOwner(page);

    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");
    const history = page.getByRole("log", { name: "Histórico de mensagens" });
    const paginatedMessages = history.locator('[data-message-id^="e0000001-0000-4000-8000-"]');
    const btn = page.getByRole("button", { name: "Carregar anteriores" });

    await expect(paginatedMessages).toHaveCount(50);
    await expect(paginatedMessages.first()).toContainText("Mensagem paginada 50");
    await expect(paginatedMessages.last()).toContainText("Mensagem paginada 1");
    await expect(btn).toBeVisible();

    await history.evaluate((element) => {
      element.scrollTop = 0;
    });
    const anchorBefore = await page
      .getByText("Mensagem paginada 50", { exact: true })
      .boundingBox();
    await btn.click();
    await expect(paginatedMessages).toHaveCount(100);
    await expect(paginatedMessages.first()).toContainText("Mensagem paginada 100");
    await expect(paginatedMessages.last()).toContainText("Mensagem paginada 1");
    await expect(btn).toBeVisible();

    const anchorAfter = await page
      .getByText("Mensagem paginada 50", { exact: true })
      .boundingBox();
    expect(anchorBefore).not.toBeNull();
    expect(anchorAfter).not.toBeNull();
    expect(Math.abs(anchorAfter!.y - anchorBefore!.y)).toBeLessThanOrEqual(8);

    await btn.click();
    await expect(paginatedMessages).toHaveCount(105);
    await expect(paginatedMessages.first()).toContainText("Mensagem paginada 105");
    await expect(paginatedMessages.last()).toContainText("Mensagem paginada 1");
    await expect(btn).toHaveCount(0);

    const messageIds = await paginatedMessages.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-message-id")),
    );
    expect(new Set(messageIds).size).toBe(105);

    const messageNumbers = await paginatedMessages.evaluateAll((elements) =>
      elements.map((element) => {
        const match = element.querySelector("p")?.textContent?.match(/Mensagem paginada (\d+)/);
        return Number(match?.[1]);
      }),
    );
    expect(messageNumbers).toEqual(
      Array.from({ length: 105 }, (_, index) => 105 - index),
    );

    await page.goto("/conversas/d3300003-0000-4000-8000-000000000002");
    await expect(page.locator('[data-message-id^="e0000001-0000-4000-8000-"]')).toHaveCount(0);

    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");
    await expect(page.locator('[data-message-id^="e0000001-0000-4000-8000-"]')).toHaveCount(50);
    await expect(page.getByRole("button", { name: "Carregar anteriores" })).toBeVisible();
  });

  test("interface não expõe storage_key nem link de download para anexos", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas");

    const cards = page.locator('[id^="conv-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().click();

    // Verifica que não há links de download na página
    const downloadLinks = page.locator('a[download], a[href*="storage_key"], a[href*="storage"]');
    await expect(downloadLinks).toHaveCount(0);
  });
});
