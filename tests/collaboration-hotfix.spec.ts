import { expect, test, type Page } from "@playwright/test";
import {
  loginAsDemoAttendant,
  loginAsDemoOwner,
  queryLocalSql,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";

const conversationId = "d3300003-0000-4000-8000-000000000001";

test.describe("Hotfix colaborativo OWNER × ATTENDANT", () => {
  test.beforeAll(() => resetAndLoadDemoMode());

  test("alterna oito mensagens entre OWNER e ATTENDANT sem perda, bloqueio ou duplicação", async ({ browser }) => {
    test.setTimeout(90_000);
    const ownerContext = await browser.newContext();
    const attendantContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const attendantPage = await attendantContext.newPage();
    await Promise.all([loginAsDemoOwner(ownerPage), loginAsDemoAttendant(attendantPage)]);
    await Promise.all([
      ownerPage.goto(`/conversas/${conversationId}`),
      attendantPage.goto(`/conversas/${conversationId}`),
    ]);

    const messages: Array<[Page, string]> = [
      [ownerPage, "HOTFIX M1 OWNER"],
      [attendantPage, "HOTFIX M2 ATTENDANT"],
      [ownerPage, "HOTFIX M3 OWNER"],
      [attendantPage, "HOTFIX M4 ATTENDANT"],
      [attendantPage, "HOTFIX M5 ATTENDANT"],
      [ownerPage, "HOTFIX M6 OWNER"],
      [attendantPage, "HOTFIX M7 ATTENDANT"],
      [ownerPage, "HOTFIX M8 OWNER"],
    ];

    for (const [page, content] of messages) {
      await page.getByRole("textbox", { name: "Digitar mensagem de texto" }).fill(content);
      await page.getByRole("button", { name: "Enviar mensagem" }).click();
      await expect(page.getByRole("log").getByText(content, { exact: true })).toHaveCount(1, {
        timeout: 15_000,
      });
    }

    await expect(ownerPage.getByRole("log").getByText("HOTFIX M8 OWNER", { exact: true })).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(attendantPage.getByRole("log").getByText("HOTFIX M8 OWNER", { exact: true })).toHaveCount(1, {
      timeout: 15_000,
    });
    expect(queryLocalSql(`
      select count(*) || '|' || count(distinct client_idempotency_key)
      from public.messages where text_content like 'HOTFIX M%';
    `)).toBe("8|8");
    expect(queryLocalSql(`
      select string_agg(app_user.display_name, '|' order by message.occurred_at, message.created_at)
      from public.messages as message
      join public.workspace_members as member on member.id = message.internal_author_member_id
      join public.app_users as app_user on app_user.id = member.user_id
      where message.text_content like 'HOTFIX M%';
    `)).toBe("Corretor ImobFlux|Atendente Demo|Corretor ImobFlux|Atendente Demo|Atendente Demo|Corretor ImobFlux|Atendente Demo|Corretor ImobFlux");

    await ownerContext.close();
    await attendantContext.close();
  });

  test("notas são autoritativas entre membros, preservam autoria e nunca viram outgoing", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const attendantContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const attendantPage = await attendantContext.newPage();
    await Promise.all([loginAsDemoOwner(ownerPage), loginAsDemoAttendant(attendantPage)]);
    await Promise.all([
      ownerPage.goto(`/conversas/${conversationId}`),
      attendantPage.goto(`/conversas/${conversationId}`),
    ]);

    await saveNote(attendantPage, "NOTA FUNCIONÁRIO");
    await ownerPage.reload();
    await expect(ownerPage.getByText("NOTA FUNCIONÁRIO", { exact: true }).first()).toBeVisible();
    await expect(ownerPage.getByText("por Atendente Demo", { exact: true }).first()).toBeVisible();

    await saveNote(ownerPage, "NOTA OWNER");
    await attendantPage.reload();
    await expect(attendantPage.getByText("NOTA FUNCIONÁRIO", { exact: true }).first()).toBeVisible();
    await expect(attendantPage.getByText("NOTA OWNER", { exact: true }).first()).toBeVisible();
    expect(queryLocalSql(`
      select count(*) from public.messages
      where text_content in ('NOTA FUNCIONÁRIO', 'NOTA OWNER');
    `)).toBe("0");

    await ownerContext.close();
    await attendantContext.close();
  });

  test("busca nova conversa resolve automaticamente e edição confirma o nome CRM", async ({ page }) => {
    runLocalSql(`
      update public.contacts set registration_status = 'provisional'
      where id = 'd3300001-0000-4000-8000-000000000001';
    `);
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${conversationId}`);

    await page.getByRole("button", { name: "Nova conversa" }).click();
    await page.getByLabel("Pesquisar nome ou número").fill("82999990001");
    const results = page.getByLabel("Resultados para nova conversa");
    await expect(results.getByText("DEMO — Cliente Público", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();

    await page.getByRole("button", { name: "Nova conversa" }).click();
    await page.getByLabel("Pesquisar nome ou número").fill("DEMO — Cliente Público");
    await expect(page.getByLabel("Resultados para nova conversa").getByText("DEMO — Cliente Público", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();

    await page.getByRole("button", { name: "Editar", exact: true }).first().click();
    await page.getByLabel("Nome no CRM").fill("Lucas CRM Confirmado");
    await page.getByRole("button", { name: "Salvar nome" }).click();
    await expect(page.getByText("Lucas CRM Confirmado", { exact: true }).first()).toBeVisible();
    await expect(page.locator(`#conv-card-${conversationId}`).getByText("Lucas CRM Confirmado", { exact: true })).toBeVisible();
    expect(queryLocalSql(`
      select display_name || '|' || registration_status from public.contacts
      where id = 'd3300001-0000-4000-8000-000000000001';
    `)).toBe("Lucas CRM Confirmado|confirmed");
    expect(queryLocalSql(`
      select external_display_name from public.contact_points
      where id = 'd3300004-0000-4000-8000-000000000001';
    `)).not.toBe("Lucas CRM Confirmado");
  });

  test("Prioridades mostra futuro de hoje, exclui amanhã e conclui sem outgoing", async ({ page }) => {
    runLocalSql(`
      insert into public.work_tasks (
        id, workspace_id, task_type, title, status, priority, due_at,
        contact_id, conversation_id, created_by_member_id
      ) select
        'd3900001-0000-4000-8000-000000000001', workspace_id, 'follow_up',
        'HOTFIX follow-up hoje', 'pending', 'normal',
        (((now() at time zone 'America/Sao_Paulo')::date + time '23:59') at time zone 'America/Sao_Paulo'),
        id, '${conversationId}',
        (select id from public.workspace_members where workspace_id = contacts.workspace_id and role = 'owner' limit 1)
      from public.contacts where id = 'd3300001-0000-4000-8000-000000000001';

      insert into public.work_tasks (
        id, workspace_id, task_type, title, status, priority, due_at,
        contact_id, conversation_id, created_by_member_id
      ) select
        'd3900001-0000-4000-8000-000000000002', workspace_id, 'follow_up',
        'HOTFIX follow-up amanhã', 'pending', 'normal',
        (((now() at time zone 'America/Sao_Paulo')::date + 1 + time '08:00') at time zone 'America/Sao_Paulo'),
        id, '${conversationId}',
        (select id from public.workspace_members where workspace_id = contacts.workspace_id and role = 'owner' limit 1)
      from public.contacts where id = 'd3300001-0000-4000-8000-000000000001';
    `);
    await loginAsDemoOwner(page);
    await page.goto("/prioridades");
    const todayItem = page.getByText("HOTFIX follow-up hoje", { exact: true }).locator("xpath=ancestor::article");
    await expect(todayItem).toBeVisible();
    await expect(todayItem.getByText(/Hoje às/)).toBeVisible();
    await expect(page.getByText("HOTFIX follow-up amanhã", { exact: true })).toHaveCount(0);
    await todayItem.getByRole("button", { name: "Concluir" }).click();
    await expect(page.getByText("HOTFIX follow-up hoje", { exact: true })).toHaveCount(0);
    expect(queryLocalSql(`select status from public.work_tasks where id = 'd3900001-0000-4000-8000-000000000001';`)).toBe("completed");
    expect(queryLocalSql(`select count(*) from public.messages where text_content like 'HOTFIX follow-up%';`)).toBe("0");
  });
});

async function saveNote(page: Page, content: string) {
  await page.getByRole("button", { name: "Nota interna" }).click();
  await page.getByRole("textbox", { name: "Digitar nota interna (apenas CRM)" }).fill(content);
  await page.getByRole("button", { name: "Salvar nota interna" }).click();
  await expect(page.getByText(content, { exact: true }).first()).toBeVisible();
}
