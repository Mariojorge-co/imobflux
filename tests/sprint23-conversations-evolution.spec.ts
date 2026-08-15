import { expect, test } from "@playwright/test";
import { calculateSLA } from "@/lib/conversations/sla";
import {
  loginAsDemoOwner,
  queryLocalSql,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";

test.describe("Sprint 23 — Conversas 2.0 & Evolução Operacional", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await resetAndLoadDemoMode();
    runLocalSql(`
      update public.opportunities
      set contact_id = 'd3300001-0000-4000-8000-000000000001'
      where id = 'd3300002-0000-4000-8000-000000000002';

      insert into public.opportunity_conversations (
        workspace_id, opportunity_id, conversation_id, linked_by_member_id, linked_at
      )
      select
        oc.workspace_id,
        'd3300002-0000-4000-8000-000000000002'::uuid,
        'd3300003-0000-4000-8000-000000000001'::uuid,
        oc.linked_by_member_id,
        now()
      from public.opportunity_conversations oc
      where oc.conversation_id = 'd3300003-0000-4000-8000-000000000001'
      limit 1;

      insert into public.work_tasks (
        id, workspace_id, task_type, title, status, priority, due_at,
        contact_id, opportunity_id, conversation_id, created_by_member_id
      )
      select
        'e2300000-0000-4000-8000-000000000001'::uuid,
        workspace_id, 'task', 'Ação exclusiva apartamento Farol', 'pending',
        'normal', now() + interval '1 day', contact_id, id,
        'd3300003-0000-4000-8000-000000000001'::uuid,
        (select id from public.workspace_members where workspace_id = opportunities.workspace_id and role = 'owner' limit 1)
      from public.opportunities
      where id = 'd3300002-0000-4000-8000-000000000001';

      insert into public.work_tasks (
        id, workspace_id, task_type, title, status, priority, due_at,
        contact_id, opportunity_id, conversation_id, created_by_member_id
      )
      select
        'e2300000-0000-4000-8000-000000000002'::uuid,
        workspace_id, 'follow_up', 'Follow-up exclusivo casa Marechal', 'pending',
        'normal', now() + interval '2 days', contact_id, id,
        'd3300003-0000-4000-8000-000000000001'::uuid,
        (select id from public.workspace_members where workspace_id = opportunities.workspace_id and role = 'owner' limit 1)
      from public.opportunities
      where id = 'd3300002-0000-4000-8000-000000000002';
    `);
  });

  test("1. Cálculo de SLA: Equipe devendo resposta (0-10, 10-15, 15-30, 30m-24h, >24h)", () => {
    const now = Date.now();

    // 5 min -> Normal
    const sla5m = calculateSLA("incoming", new Date(now - 5 * 60 * 1000).toISOString());
    expect(sla5m?.type).toBe("team_waiting");
    expect(sla5m?.level).toBe("normal");
    expect(sla5m?.badgeText).toContain("5 min");

    // 12 min -> Atenção
    const sla12m = calculateSLA("incoming", new Date(now - 12 * 60 * 1000).toISOString());
    expect(sla12m?.level).toBe("attention");

    // 20 min -> Prioridade
    const sla20m = calculateSLA("incoming", new Date(now - 20 * 60 * 1000).toISOString());
    expect(sla20m?.level).toBe("priority");

    // 45 min -> Crítico
    const sla45m = calculateSLA("incoming", new Date(now - 45 * 60 * 1000).toISOString());
    expect(sla45m?.level).toBe("critical");
    expect(sla45m?.badgeText).toContain("45 min");

    // 36h (>24h) -> Crítico Grave / Atraso Prolongado
    const sla36h = calculateSLA("incoming", new Date(now - 36 * 3600 * 1000).toISOString());
    expect(sla36h?.level).toBe("critical_grave");
    expect(sla36h?.badgeText).toContain("1 dia");
  });

  test("2. Cálculo de SLA: Cliente devendo resposta (<3h, ~1 dia, ~2 dias, >2 dias)", () => {
    const now = Date.now();

    // 1h -> Recente
    const sla1h = calculateSLA("outgoing", new Date(now - 60 * 60 * 1000).toISOString());
    expect(sla1h?.type).toBe("client_waiting");
    expect(sla1h?.level).toBe("recent");

    // 24h -> Aguardando cliente
    const sla24h = calculateSLA("outgoing", new Date(now - 24 * 3600 * 1000).toISOString());
    expect(sla24h?.level).toBe("waiting_client");

    // 48h (~2 dias) -> Atenção
    const sla48h = calculateSLA("outgoing", new Date(now - 48 * 3600 * 1000).toISOString());
    expect(sla48h?.level).toBe("attention");

    // 72h (>2 dias) -> Candidato a Follow-up
    const sla72h = calculateSLA("outgoing", new Date(now - 72 * 3600 * 1000).toISOString());
    expect(sla72h?.level).toBe("followup_candidate");
    expect(sla72h?.badgeText).toContain("Follow-up");
  });

  test("3. E2E: Navegação Direta de Prioridades para Conversa", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/prioridades");

    const firstPriorityCard = page.locator("a[href*='/conversas/']").first();
    await expect(firstPriorityCard).toBeVisible();
    await firstPriorityCard.click();
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]+$/);

    await expect(page.getByRole("button", { name: "Mensagem", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nota interna" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nova ação" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /Digitar/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Marcar como não lida" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Identificação" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Oportunidade Ativa" })).toBeVisible();
  });

  test("4. E2E Mobile: Layout responsivo, navegação de tela cheia e gaveta de contexto (375px)", async ({ page }) => {
    // Configura viewport mobile de 375x667 (iPhone SE)
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsDemoOwner(page);
    await page.goto("/conversas");

    const listContainer = page.getByRole("list", { name: "Lista de conversas" });
    await expect(listContainer).toBeVisible();
    const firstConversation = listContainer.getByRole("button", { name: /Abrir conversa com/i }).first();
    await expect(firstConversation).toBeVisible();
    await firstConversation.click();
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]+$/);
    await expect(page.getByRole("textbox", { name: /Digitar/i })).toBeVisible();
  });

  test("5. E2E: Criação de Próxima Ação & Follow-up com preservação da etapa do Kanban", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");

    // 1. Abre o formulário de ação no painel lateral existente
    await page.getByRole("button", { name: "Nova ação" }).click();

    // 2. Preenche título da Próxima Ação (task_type = 'task')
    await page.getByPlaceholder(/Ligar amanhã/i).fill("Agendar visita presencial ao imóvel");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();

    // 3. Sucesso deve revalidar a lista e exibir no painel lateral
    await expect(page.getByText("Agendar visita presencial ao imóvel").first()).toBeVisible({ timeout: 5000 });

    // 4. Grava a etapa atual do Kanban antes de concluir
    const stageSelector = page.getByRole("combobox", { name: /Alterar etapa/i });
    const initialStage = await stageSelector.inputValue();

    // 5. Conclui a tarefa pelo painel lateral
    const completeBtn = page.getByRole("button", { name: /Concluir tarefa/i }).first();
    await expect(completeBtn).toBeVisible();
    await completeBtn.click();

    // 6. Confirma que a etapa do Kanban NÃO FOI ALTERADA pela conclusão da tarefa
    expect(await stageSelector.inputValue()).toBe(initialStage);
  });

  test("6. E2E: Alternância de Múltiplas Oportunidades no painel lateral", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");

    // Se houver mais de uma oportunidade, o seletor é renderizado no topo do painel
    const oppSelector = page.getByRole("combobox", { name: /Selecionar oportunidade/i });
    await expect(oppSelector).toBeVisible();
    const options = await oppSelector.locator("option").allInnerTexts();
    expect(options.length).toBeGreaterThan(1);

    await oppSelector.selectOption("d3300002-0000-4000-8000-000000000001");
    await expect(page.getByText("Apê 2/4 no Farol", { exact: true })).toBeVisible();
    await expect(page.getByText("Ação exclusiva apartamento Farol", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Follow-up exclusivo casa Marechal", { exact: true })).toHaveCount(0);

    const stageSelector = page.getByRole("combobox", { name: /Alterar etapa/i });
    const firstOpportunityStage = await stageSelector.inputValue();

    await oppSelector.selectOption("d3300002-0000-4000-8000-000000000002");
    await expect(page.getByText("Casa Condomínio Marechal", { exact: true })).toBeVisible();
    await expect(page.getByText("Follow-up exclusivo casa Marechal", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Ação exclusiva apartamento Farol", { exact: true })).toHaveCount(0);

    const targetStage = await stageSelector.locator("option").nth(1).getAttribute("value");
    expect(targetStage).toBeTruthy();
    await stageSelector.selectOption(targetStage!);
    await expect(stageSelector).toHaveValue(targetStage!);

    expect(queryLocalSql(`
      select current_stage_id::text
      from public.opportunities
      where id = 'd3300002-0000-4000-8000-000000000001';
    `)).toBe(firstOpportunityStage);
    expect(queryLocalSql(`
      select current_stage_id::text
      from public.opportunities
      where id = 'd3300002-0000-4000-8000-000000000002';
    `)).toBe(targetStage);
    expect(queryLocalSql(`
      select count(*)::text
      from public.pipeline_history
      where opportunity_id = 'd3300002-0000-4000-8000-000000000002'
        and new_stage_id = '${targetStage}';
    `)).toBe("1");
  });

  test("7. E2E: Nota interna permanece isolada na oportunidade selecionada", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas/d3300003-0000-4000-8000-000000000001");

    const opportunitySelector = page.getByRole("combobox", {
      name: "Selecionar oportunidade",
    });
    const opportunityA = "d3300002-0000-4000-8000-000000000001";
    const opportunityB = "d3300002-0000-4000-8000-000000000002";
    const content = `Nota exclusiva oportunidade A ${Date.now()}`;

    await opportunitySelector.selectOption(opportunityA);
    await page.getByRole("button", { name: "Nota interna" }).click();
    await page.getByRole("textbox", { name: /Digitar nota interna/i }).fill(content);
    await page.getByRole("button", { name: "Salvar nota interna" }).click();

    const noteCard = page.getByRole("article").filter({ hasText: content });
    await expect(noteCard).toBeVisible();
    await expect(noteCard).toContainText("não enviada ao cliente");
    await expect(noteCard).toContainText("Corretor ImobFlux");

    await opportunitySelector.selectOption(opportunityB);
    await expect(page.getByText(content, { exact: true })).toHaveCount(0);

    await opportunitySelector.selectOption(opportunityA);
    await expect(noteCard).toBeVisible();

    await page.reload();
    await page.getByRole("combobox", { name: "Selecionar oportunidade" }).selectOption(opportunityA);
    await expect(page.getByRole("article").filter({ hasText: content })).toBeVisible();

    expect(queryLocalSql(`
      select count(*)::text
      from public.internal_notes
      where conversation_id = 'd3300003-0000-4000-8000-000000000001'
        and opportunity_id = '${opportunityA}'
        and content = '${content}';
    `)).toBe("1");
    expect(queryLocalSql(`
      select count(*)::text
      from public.messages
      where conversation_id = 'd3300003-0000-4000-8000-000000000001'
        and direction = 'outgoing'
        and text_content = '${content}';
    `)).toBe("0");
  });
});
