import { expect, test } from "@playwright/test";
import {
  loginAsDemoOwner,
  queryLocalSql,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";

const conversationOne = "d3300003-0000-4000-8000-000000000001";
const conversationTwo = "d3300003-0000-4000-8000-000000000002";

test.describe("Hotfix funcional de conversas e prioridades", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await resetAndLoadDemoMode();
  });

  test("mensagem persistida aparece imediatamente, atualiza preview e não duplica", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${conversationOne}`);

    const content = `Mensagem hotfix ${Date.now()}`;
    const history = page.getByRole("log", { name: "Histórico de mensagens" });
    const list = page.getByRole("list", { name: "Lista de conversas" });

    await page.getByRole("textbox", { name: "Digitar mensagem de texto" }).fill(content);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();

    await expect(history.getByText(content, { exact: true })).toHaveCount(1);
    await expect(list.getByText(content, { exact: true })).toBeVisible();
    await expect(page.getByText("Mensagem enviada com sucesso.", { exact: true })).toHaveCount(0);
    expect(queryLocalSql(`
      select count(*)::text from public.messages
      where conversation_id = '${conversationOne}' and text_content = '${content}';
    `)).toBe("1");

    await page.reload();
    await expect(history.getByText(content, { exact: true })).toHaveCount(1);
  });

  test("marcar não lida é estável durante a visualização e auto-read ocorre ao reabrir", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });

    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${conversationOne}`);

    await page.getByRole("button", { name: "Marcar como não lida" }).click();
    await expect(page.getByRole("button", { name: "Marcar como lida" })).toBeVisible();
    const selectedCard = page.locator(`#conv-card-${conversationOne}`);
    await expect(selectedCard.locator('[title="Não lida"]')).toBeVisible();

    await page.goto(`/conversas/${conversationTwo}`);
    await page.goto(`/conversas/${conversationOne}`);
    await expect(page.getByRole("button", { name: "Marcar como não lida" })).toBeVisible();
    await expect(selectedCard.locator('[title="Não lida"]')).toHaveCount(0);
    expect(queryLocalSql(`
      select is_unread::text from public.conversation_read_states
      where conversation_id = '${conversationOne}' order by updated_at desc limit 1;
    `)).toBe("false");
    expect(runtimeErrors.filter((text) => /revalidatePath|render/i.test(text))).toEqual([]);
  });

  test("prioridades aplica 24h e ordena as duas filas do mais antigo", async ({ page }) => {
    runLocalSql(`
      update public.messages set occurred_at = now() - interval '1 minute';

      update public.messages set occurred_at = now() - interval '3 days'
      where conversation_id = 'd3300003-0000-4000-8000-000000000003';
      update public.messages set occurred_at = now() - interval '2 days'
      where conversation_id = 'd3300003-0000-4000-8000-000000000007';
      update public.messages set occurred_at = now() - interval '1 day'
      where conversation_id = 'd3300003-0000-4000-8000-000000000006';

      update public.messages set occurred_at = now() - interval '5 days'
      where conversation_id = 'd3300003-0000-4000-8000-000000000004';
      update public.messages set occurred_at = now() - interval '4 days'
      where conversation_id = 'd3300003-0000-4000-8000-000000000009';
      update public.messages set occurred_at = now() - interval '2 days'
      where conversation_id = 'd3300003-0000-4000-8000-000000000012';
      update public.messages set occurred_at = now() - interval '24 hours'
      where conversation_id = 'd3300003-0000-4000-8000-000000000010';
      update public.messages set occurred_at = now() - interval '1439 minutes'
      where conversation_id = 'd3300003-0000-4000-8000-000000000015';
    `);

    await loginAsDemoOwner(page);
    await page.goto("/prioridades");

    const team = page.locator('section[aria-labelledby="equipe-devendo"]');
    const teamNames = await team.locator("h3").allInnerTexts();
    expect(teamNames.indexOf("Bruno Henrique Martins")).toBeLessThan(
      teamNames.indexOf("Fernando Augusto Souza"),
    );
    expect(teamNames.indexOf("Fernando Augusto Souza")).toBeLessThan(
      teamNames.indexOf("Elena Castro Mello"),
    );

    const client = page.locator('section[aria-labelledby="aguardando-cliente"]');
    await expect(client.getByText("Otavio Augusto Rezende", { exact: true })).toHaveCount(0);
    const clientNames = await client.locator("h3").allInnerTexts();
    expect(clientNames).toEqual([
      "Camila Rocha Lima",
      "Heitor Alencar Mendes",
      "Larissa Beatriz Siqueira",
      "Isabela Maria Freitas",
    ]);
  });
});
