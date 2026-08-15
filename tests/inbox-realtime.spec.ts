import { expect, test, type Page } from "@playwright/test";
import {
  loginAsDemoAttendant,
  loginAsDemoOwner,
  queryLocalSql,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";

const conversationId = "d3300003-0000-4000-8000-000000000001";

test.describe.serial("Inbox autorizada e Realtime", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await resetAndLoadDemoMode();
  });

  test("OWNER arquiva, envia sem desarquivar e restaura manualmente", async ({ page }) => {
    await loginAsDemoOwner(page);
    await exerciseArchivedConversationFlow(page, "OWNER");
  });

  test("ATTENDANT autorizado envia e restaura conversa arquivada", async ({ page }) => {
    await loginAsDemoAttendant(page);
    await exerciseArchivedConversationFlow(page, "ATTENDANT");
  });

  test("mensagem recebida reconcilia preview em tempo real e não desarquiva", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${conversationId}`);
    await page.getByRole("button", { name: "Arquivar conversa" }).click();
    await expect.poll(() => conversationIsArchived()).toBe("true");
    await page.goto("/conversas");
    await page.getByRole("button", { name: /^Arquivadas \(/ }).click();
    await expect(page.locator(`#conv-card-${conversationId}`)).toBeVisible();
    await expect.poll(
      () => page.evaluate(() => document.documentElement.dataset.realtimeInbox ?? "missing"),
      { timeout: 15_000 },
    ).toBe("ready");

    const content = `Realtime arquivada ${Date.now()}`;
    runLocalSql(`
      insert into public.messages (
        workspace_id, channel_connection_id, conversation_id,
        external_message_id, direction, origin, sender_contact_point_id,
        text_content, status, occurred_at, external_created_at, received_at
      ) values (
        (select workspace_id from public.conversations where id = '${conversationId}'),
        'd3300000-0000-4000-8000-000000000001', '${conversationId}',
        'realtime-${Date.now()}', 'incoming', 'whatsapp',
        'd3300004-0000-4000-8000-000000000001',
        '${content}', 'received', now(), now(), now()
      );
    `);

    await expect(page.locator(`#conv-card-${conversationId}`).getByText(content, { exact: true })).toBeVisible({ timeout: 15_000 });
    expect(queryLocalSql(`select (archived_at is not null)::text from public.conversations where id = '${conversationId}';`)).toBe("true");

    await page.getByRole("button", { name: /^Tudo \(/ }).click();
    await expect(page.locator(`#conv-card-${conversationId}`)).toHaveCount(0);
  });
});

async function exerciseArchivedConversationFlow(
  page: Page,
  actor: "OWNER" | "ATTENDANT",
) {
  const content = `${actor} envia em conversa arquivada ${Date.now()}`;

  await page.goto(`/conversas/${conversationId}`);
  await expect(page.getByRole("button", { name: "Arquivar conversa" })).toBeVisible();
  await page.getByRole("button", { name: "Arquivar conversa" }).click();
  await expect.poll(() => conversationIsArchived()).toBe("true");

  await page.goto("/conversas");
  await page.getByRole("button", { name: /^Arquivadas \(/ }).click();
  const archivedCard = page.locator(`#conv-card-${conversationId}`);
  await expect(archivedCard).toBeVisible();
  await archivedCard.click();

  await expect(page.getByRole("button", { name: "Desarquivar conversa" })).toBeVisible();
  await page.getByRole("textbox", { name: "Digitar mensagem de texto" }).fill(content);
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(
    page.getByRole("log", { name: "Histórico de mensagens" }).getByText(content, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Erro ao enfileirar mensagem de saída", { exact: true })).toHaveCount(0);
  expect(queryLocalSql(`select count(*) from public.messages where text_content = '${content}';`)).toBe("1");
  expect(conversationIsArchived()).toBe("true");

  await page.getByRole("button", { name: "Desarquivar conversa" }).click();
  await expect.poll(() => conversationIsArchived()).toBe("false");

  await page.goto("/conversas");
  await expect(page.locator(`#conv-card-${conversationId}`)).toBeVisible();
  await page.getByRole("button", { name: /^Arquivadas \(/ }).click();
  await expect(page.locator(`#conv-card-${conversationId}`)).toHaveCount(0);
}

function conversationIsArchived() {
  return queryLocalSql(`
    select (archived_at is not null)::text
    from public.conversations
    where id = '${conversationId}';
  `);
}
