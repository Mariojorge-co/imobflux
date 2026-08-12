import { expect, test } from "@playwright/test";
import {
  loginAsDemoOwner,
  queryLocalSql,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";

const conversationId = "d3300003-0000-4000-8000-000000000001";

test.describe.serial("Inbox autorizada e Realtime", () => {
  test.beforeAll(() => resetAndLoadDemoMode());

  test("filtros e arquivamento compartilhado preservam a conversa fora da inbox", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${conversationId}`);

    await expect(page.getByRole("button", { name: /^Tudo \(/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Não lidas \(/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Grupos \(/ })).toBeVisible();

    await page.getByRole("button", { name: "Arquivar conversa" }).click();
    await expect(page).toHaveURL(/\/conversas$/);
    await page.getByRole("button", { name: /^Arquivadas \(/ }).click();
    await expect(page.locator(`#conv-card-${conversationId}`)).toBeVisible();
  });

  test("mensagem recebida reconcilia preview em tempo real e não desarquiva", async ({ page }) => {
    await loginAsDemoOwner(page);
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
