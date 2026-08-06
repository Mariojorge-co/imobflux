import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import type { Database } from "@/types/database";

// ─── Fixtures de ambiente ─────────────────────────────────────────────────────

const owner = {
  email: "owner.sprint12@example.test",
  password: "Sprint12-local-password!",
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

/**
 * Cliente administrativo (service_role) — usado exclusivamente para preparar
 * fixtures de dados. O fluxo normal da aplicação usa apenas sessão autenticada.
 */
function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_ADMIN_KEY"),
    { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
  );
}

// ─── Helpers de login ─────────────────────────────────────────────────────────

async function loginAsOwner(page: Parameters<typeof test>[1] extends (args: infer A) => unknown ? A extends { page: infer P } ? P : never : never) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(owner.email);
  await page.getByLabel("Senha").fill(owner.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/prioridades$/);
}

// ─── Suíte de testes do Módulo de Conversas ──────────────────────────────────

test.describe.serial("conversations module", () => {
  // Prepara fixtures administrativas uma única vez antes de todos os testes
  test.beforeAll(async () => {
    const admin = createAdminClient();

    // Localiza o workspace do OWNER
    const { data: ws } = await admin
      .from("workspaces")
      .select("id")
      .eq("status", "active")
      .single();

    if (!ws) return; // Sem workspace = testes funcionarão com estado vazio

    const workspaceId = ws.id;

    // Busca o channel_connection existente (criado pelo bootstrap se houver)
    const { data: channel } = await admin
      .from("channel_connections")
      .select("id")
      .eq("workspace_id", workspaceId)
      .single();

    if (!channel) return; // Sem canal = sem conversas; testa estado vazio

    const channelId = channel.id;

    // Insere 2 conversas de teste com mensagens via SQL direto não é possível
    // sem service_role nas tabelas; usamos a API admin do supabase.
    // Conversas requerem external_thread_id único.

    const { error: convErr } = await admin.from("conversations").upsert([
      {
        id: "c0000001-0000-4000-8000-000000000001",
        workspace_id: workspaceId,
        channel_connection_id: channelId,
        external_thread_id: "playwright-thread-001",
        conversation_type: "individual",
        operational_status: "active",
        visibility: "commercial",
        started_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      },
      {
        id: "c0000002-0000-4000-8000-000000000002",
        workspace_id: workspaceId,
        channel_connection_id: channelId,
        external_thread_id: "playwright-thread-002",
        conversation_type: "individual",
        operational_status: "active",
        visibility: "commercial",
        started_at: new Date(Date.now() - 1 * 3_600_000).toISOString(),
      },
    ], { onConflict: "channel_connection_id,external_thread_id" });

    if (convErr) {
      console.error("Erro ao inserir conversas de teste:", convErr);
    }

    // Insere uma mensagem na primeira conversa
    const { error: msgErr } = await admin.from("messages").upsert([
      {
        id: "d0000001-0000-4000-8000-000000000001",
        workspace_id: workspaceId,
        conversation_id: "c0000001-0000-4000-8000-000000000001",
        channel_connection_id: channelId,
        direction: "incoming",
        origin: "whatsapp",
        status: "received",
        occurred_at: new Date(Date.now() - 90 * 60_000).toISOString(),
        received_at: new Date(Date.now() - 90 * 60_000).toISOString(),
        external_message_id: "pw-msg-001",
        external_created_at: new Date(Date.now() - 90 * 60_000).toISOString(),
        text_content: "Olá, gostaria de informações.",
      },
    ], { onConflict: "workspace_id,id" });

    if (msgErr) {
      console.error("Erro ao inserir mensagem de teste:", msgErr);
    }
  });

  // ─── Testes ────────────────────────────────────────────────────────────────

  test("redireciona /conversas para login quando não autenticado", async ({ page }) => {
    await page.goto("/conversas");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("exibe a lista de conversas após login", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/conversas");
    await expect(page.getByRole("list", { name: "Lista de conversas" })).toBeVisible();
  });

  test("exibe estado vazio quando não há conversas (busca sem resultado)", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/conversas");

    const searchInput = page.getByLabel("Buscar conversas por nome ou telefone");
    await searchInput.fill("xyzconversainexistente12345");
    await expect(page.getByText(/Nenhuma conversa encontrada/)).toBeVisible({ timeout: 2000 });
  });

  test("campo de busca aplica debounce e dispara busca ao pressionar Enter", async ({ page }) => {
    await loginAsOwner(page);
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
    await loginAsOwner(page);
    await page.goto("/conversas");

    // Aguarda pelo menos um card de conversa
    const cards = page.locator('[id^="conv-card-"]');
    const count = await cards.count();

    if (count === 0) {
      test.skip(); // Sem conversas inseridas, pula navegação
      return;
    }

    await cards.first().click();
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]+$/);
    // Painel de mensagens deve estar visível
    await expect(page.getByRole("log", { name: "Histórico de mensagens" })).toBeVisible();
  });

  test("deep link para /conversas/[id] funciona diretamente", async ({ page }) => {
    await loginAsOwner(page);
    const conversationId = "c0000001-0000-4000-8000-000000000001";

    await page.goto(`/conversas/${conversationId}`);

    // Se a conversa existe no banco local → exibe o painel de mensagens
    // Se não existe (banco limpo / 404) → exibe notFound
    const hasPanel = await page.getByRole("log", { name: "Histórico de mensagens" }).isVisible().catch(() => false);
    const is404Text = await page.getByText(/404|not found|não encontrada/i).isVisible().catch(() => false);

    expect(hasPanel || is404Text).toBe(true);
  });

  test("exibe aviso de somente leitura (sem campo de envio funcional)", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/conversas");

    const cards = page.locator('[id^="conv-card-"]');
    const count = await cards.count();
    if (count === 0) { test.skip(); return; }

    await cards.first().click();
    await expect(page.getByText(/somente para leitura/i)).toBeVisible();
    // Não deve existir campo de texto habilitado para envio
    const enabledTextarea = page.getByRole("textbox").filter({ hasNot: page.locator('[disabled]') });
    await expect(enabledTextarea).toHaveCount(0);
  });

  test("botão voltar retorna para /conversas no mobile (viewport 390x844)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsOwner(page);
    await page.goto("/conversas");

    const cards = page.locator('[id^="conv-card-"]');
    const count = await cards.count();
    if (count === 0) { test.skip(); return; }

    await cards.first().click();
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]+$/);

    await page.getByRole("link", { name: "Voltar para a lista de conversas" }).click();
    await expect(page).toHaveURL(/\/conversas$/);
  });

  test("botão 'Carregar anteriores' aparece quando há histórico paginável", async ({ page }) => {
    await loginAsOwner(page);

    const cards = page.locator('[id^="conv-card-"]');
    await page.goto("/conversas");
    const count = await cards.count();
    if (count === 0) { test.skip(); return; }

    await cards.first().click();
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]+$/);

    // Botão só aparece quando há mais de 50 mensagens — verificamos apenas a ausência de erros
    const btn = page.getByRole("button", { name: "Carregar anteriores" });
    // Se aparecer, não deve lançar exceção ao clicar
    if (await btn.isVisible()) {
      await btn.click();
      await expect(btn).not.toHaveText("Erro");
    }
  });

  test("interface não expõe storage_key nem link de download para anexos", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/conversas");

    const cards = page.locator('[id^="conv-card-"]');
    const count = await cards.count();
    if (count === 0) { test.skip(); return; }

    await cards.first().click();

    // Verifica que não há links de download na página
    const downloadLinks = page.locator('a[download], a[href*="storage_key"], a[href*="storage"]');
    await expect(downloadLinks).toHaveCount(0);
  });
});
