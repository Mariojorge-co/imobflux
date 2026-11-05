import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode, runLocalSql } from "./helpers/local-test-state";
import { activeInstance, ingestText, postWebhook } from "./helpers/webhook";

// Reação feita por um CLIENTE (não pelo Mário). Caso real de produção: o JID da conversa chega com 12 dígitos (sem o nono dígito)
// e o contato está cadastrado com 13; antes da correção a reação era descartada como "unknown_reactor".
// A Evolution é SIMULADA; nada sai para a internet. Números fictícios.

const FAKE_PORT = 3099;
const JID_12 = "558288889001@s.whatsapp.net";
const PHONE_13 = "+5582988889001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TEXT = "Mensagem de texto do Mário";
const PHOTO_ID = "RC-FOTO-1";

let fake: FakeEvolution;
let conversation = "";

const history = (page: Page) => page.getByLabel("Histórico de mensagens");
const textRow = (page: Page) => history(page).locator("[data-message-id]").filter({ hasText: TEXT }).first();
const photoRow = (page: Page) => {
  const id = queryLocalSql(`select id from public.messages where external_message_id = '${PHOTO_ID}';`);
  return history(page).locator(`[data-message-id="${id}"]`);
};
const externalIdOfText = () => queryLocalSql(`select external_message_id from public.messages where conversation_id = '${conversation}' and text_content = '${TEXT}' limit 1;`);

async function open(page: Page) {
  await page.goto(`/conversas/${conversation}`);
  await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

async function clientReacts(request: APIRequestContext, targetId: string, emoji: string, key: Record<string, unknown> = { remoteJid: JID_12 }) {
  const response = await postWebhook(request, {
    event: "messages.upsert",
    instance: activeInstance(),
    data: {
      key: { ...key, fromMe: false, id: `RC-REACT-${Date.now()}-${Math.floor(Math.random() * 1e6)}` },
      message: { reactionMessage: { key: { id: targetId, remoteJid: JID_12, fromMe: true }, text: emoji } },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { status?: string; reason?: string };
}

test.describe.configure({ mode: "serial" });

test.describe("Reação de cliente (nono dígito e @lid)", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    fake.behavior.media = () => ({ base64: PNG.toString("base64"), mimetype: "image/png" });
    // Conversa nascida com o JID de 12 dígitos; o texto e a foto são do Mário (enviados pelo celular da conta).
    conversation = await ingestText(request, { jid: JID_12, text: "Oi, quero informações", pushName: "Cliente Reação" });
    await ingestText(request, { jid: JID_12, text: TEXT, fromMe: true, id: "RC-TEXTO-1" });
    const photo = await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: {
        key: { remoteJid: JID_12, fromMe: true, id: PHOTO_ID },
        message: { imageMessage: { mimetype: "image/png", fileLength: PNG.length } },
        base64: PNG.toString("base64"),
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(photo.ok()).toBe(true);
    // O contato fica cadastrado com 13 dígitos (como no cadastro manual em produção).
    runLocalSql(`update public.contact_points set normalized_value = '${PHONE_13}' where normalized_value = '+558288889001';`);
    expect(queryLocalSql(`select count(*) from public.contact_points where normalized_value = '${PHONE_13}';`)).toBe("1");
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoOwner(page);
  });

  test("o cliente reage à foto e ao texto, troca o emoji e remove", async ({ page, request }) => {
    expect(externalIdOfText()).toBe("RC-TEXTO-1");

    expect((await clientReacts(request, PHOTO_ID, "👍")).status).toBe("success");
    expect((await clientReacts(request, "RC-TEXTO-1", "❤️")).status).toBe("success");
    expect(queryLocalSql("select count(*) from public.message_reactions where contact_point_id is not null;")).toBe("2");

    await open(page);
    await expect(photoRow(page).getByTestId("message-reactions")).toContainText("👍");
    await expect(textRow(page).getByTestId("message-reactions")).toContainText("❤️");

    // Trocar o emoji: continua uma reação por contato.
    expect((await clientReacts(request, PHOTO_ID, "🔥")).status).toBe("success");
    expect(queryLocalSql(`select count(*) from public.message_reactions where message_id = (select id from public.messages where external_message_id = '${PHOTO_ID}');`)).toBe("1");
    await page.reload();
    await expect(photoRow(page).getByTestId("message-reactions")).toContainText("🔥");
    await expect(photoRow(page).getByTestId("message-reactions")).not.toContainText("👍");

    // Remover (texto vazio).
    expect((await clientReacts(request, PHOTO_ID, "")).status).toBe("removed");
    expect((await clientReacts(request, "RC-TEXTO-1", "")).status).toBe("removed");
    expect(queryLocalSql("select count(*) from public.message_reactions where contact_point_id is not null;")).toBe("0");
    await page.reload();
    await expect(photoRow(page)).toBeVisible();
    await expect(photoRow(page).getByTestId("message-reactions")).toHaveCount(0);
    await expect(textRow(page).getByTestId("message-reactions")).toHaveCount(0);
  });

  test("reação com @lid (telefone só em remoteJidAlt, ou nenhum) também chega ao contato da conversa", async ({ page, request }) => {
    const withAlt = await clientReacts(request, "RC-TEXTO-1", "🙏", { remoteJid: "218943875198110@lid", remoteJidAlt: JID_12 });
    expect(withAlt.status).toBe("success");
    const withoutAlt = await clientReacts(request, PHOTO_ID, "😂", { remoteJid: "218943875198110@lid" });
    expect(withoutAlt.status).toBe("success");
    await open(page);
    await expect(textRow(page).getByTestId("message-reactions")).toContainText("🙏");
    await expect(photoRow(page).getByTestId("message-reactions")).toContainText("😂");
  });

  test("reação em grupo continua ignorada e nada é gravado", async ({ request }) => {
    const before = queryLocalSql("select count(*) from public.message_reactions;");
    const response = await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: {
        key: { remoteJid: "120363009001000001@g.us", fromMe: false, id: `RC-G-${Date.now()}`, participant: "5582988889002@s.whatsapp.net" },
        message: { reactionMessage: { key: { id: "RC-TEXTO-1", remoteJid: "120363009001000001@g.us", fromMe: true }, text: "👍" } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(response.ok()).toBe(true);
    expect(((await response.json()) as { status?: string }).status).toBe("ignored");
    expect(queryLocalSql("select count(*) from public.message_reactions;")).toBe(before);
  });
});
