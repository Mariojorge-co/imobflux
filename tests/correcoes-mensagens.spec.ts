import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoAttendant, loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode, runLocalSql } from "./helpers/local-test-state";
import { activeInstance, ingestText, postWebhook, textPayload, type WebhookTextInput } from "./helpers/webhook";

// Correções depois do teste real: JID real nas ações, estado pendente/confirmado, edição/exclusão/citação/reação vindas do
// celular, reação única da conta, menu sem corte e notas internas editáveis. A Evolution é SIMULADA.

const FAKE_PORT = 3099;
// O WhatsApp conhece o contato SEM o 9º dígito (12 dígitos); a conversa guarda o JID COM o 9 (13), como as criadas pelo ImobFlux.
const REAL_JID = "558299994001@s.whatsapp.net";
const STORED_JID = "5582999994001@s.whatsapp.net";

let fake: FakeEvolution;
let conversation = "";

const history = (page: Page) => page.getByLabel("Histórico de mensagens");
const row = (page: Page, text: string) => history(page).locator("[data-message-id]").filter({ hasText: text }).first();
const requestsTo = (fragment: string) => fake.requests.filter((request) => request.path.includes(fragment));
const messageField = (text: string, field: string) =>
  queryLocalSql(`select ${field} from public.messages where conversation_id = '${conversation}' and text_content = '${text}' limit 1;`);

async function open(page: Page) {
  await page.goto(`/conversas/${conversation}`);
  await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

async function openMenu(page: Page, text: string) {
  const target = row(page, text);
  await target.hover();
  await target.getByTestId("message-menu-button").click();
  const menu = page.getByTestId("message-menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function send(page: Page, text: string) {
  await page.getByLabel("Digitar mensagem de texto").fill(text);
  await page.keyboard.press("Enter");
  await expect(row(page, text)).toBeVisible();
  await expect(history(page).getByTestId("message-sending")).toHaveCount(0, { timeout: 20_000 });
}

const post = async (request: Parameters<typeof postWebhook>[0], data: Record<string, unknown>, event = "messages.upsert") => {
  const response = await postWebhook(request, { event, instance: activeInstance(), data });
  expect(response.ok()).toBe(true);
};
/** Mensagem pelo webhook com o JID real (12 dígitos): a conversa guarda o JID de 13 dígitos e mesmo assim a reconhece. */
const phoneText = async (request: Parameters<typeof postWebhook>[0], input: Omit<WebhookTextInput, "jid">) => {
  const response = await postWebhook(request, textPayload({ jid: REAL_JID, pushName: "Cliente Real Jid", ...input }));
  expect(response.ok()).toBe(true);
};
const key = (id: string, fromMe: boolean) => ({ remoteJid: REAL_JID, fromMe, id });

test.describe.configure({ mode: "serial" });

test.describe("Correções pós-teste das mensagens", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: REAL_JID, text: "Oi, tudo bem?", pushName: "Cliente Real Jid" });
    runLocalSql(`update public.conversations set external_thread_id = '${STORED_JID}' where id = '${conversation}';`);
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(async ({ page }) => {
    fake.reset();
    fake.behavior.jidFor = (digits) => (digits === "5582999994001" ? REAL_JID : `${digits}@s.whatsapp.net`);
    await loginAsDemoOwner(page);
  });

  test("aquecimento", async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
  });

  test("editar: usa o JID REAL na chave, fica 'aguardando confirmação do WhatsApp' e confirma quando o eco chega", async ({ page, request }) => {
    test.setTimeout(120_000);
    await open(page);
    await send(page, "Texto para editar");
    const menu = await openMenu(page, "Texto para editar");
    await menu.getByTestId("action-edit").click();
    const box = page.getByLabel("Digitar mensagem de texto");
    await box.fill("Texto já editado");
    await page.keyboard.press("Enter");

    await expect.poll(() => requestsTo("/chat/updateMessage/").length).toBe(1);
    const edits = requestsTo("/chat/updateMessage/");
    expect(edits[0].body).toMatchObject({ number: "558299994001", key: { remoteJid: REAL_JID, fromMe: true } });
    // (a consulta do JID real fica em cache por 10 min no servidor: o que vale aqui é a chave enviada)

    const bubble = row(page, "Texto já editado");
    await expect(bubble.getByTestId("edited-mark")).toBeVisible();
    await expect(bubble.getByTestId("wa-pending")).toContainText("aguardando confirmação do WhatsApp");
    expect(messageField("Texto já editado", "wa_pending_action")).toBe("edit");

    // O WhatsApp devolve a edição (mesmo texto): a pendência some e não conta como nova edição.
    const externalId = messageField("Texto já editado", "external_message_id");
    await post(request, {
      key: key("ECO-EDIT-1", true),
      message: { protocolMessage: { type: "MESSAGE_EDIT", key: key(externalId, true), editedMessage: { conversation: "Texto já editado" } } },
      messageTimestamp: Math.floor(Date.now() / 1000),
    }, "messages.edited");
    await expect.poll(() => messageField("Texto já editado", "coalesce(wa_pending_action, 'nenhuma')")).toBe("nenhuma");
    expect(messageField("Texto já editado", "edit_count")).toBe("1");
    await open(page);
    await expect(row(page, "Texto já editado").getByTestId("wa-pending")).toHaveCount(0);
    await expect(row(page, "Texto já editado").getByTestId("edited-mark")).toBeVisible();
  });

  test("editar com a Evolution recusando: não vira 'editada', o original continua e dá para tentar de novo", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    await send(page, "Original que fica");
    fake.behavior.fail = (req) => (req.path.includes("/chat/updateMessage/") ? 400 : null);
    const menu = await openMenu(page, "Original que fica");
    await menu.getByTestId("action-edit").click();
    await page.getByLabel("Digitar mensagem de texto").fill("Tentativa que falha");
    await page.keyboard.press("Enter");
    await expect(page.locator("#msg-send-feedback")).toContainText("A mensagem não foi alterada.", { timeout: 20_000 });
    await expect(row(page, "Original que fica").getByTestId("edited-mark")).toHaveCount(0);
    expect(messageField("Original que fica", "coalesce(edited_at::text, 'nunca')")).toBe("nunca");
    // tentar de novo (a Evolution volta a aceitar)
    fake.behavior.fail = undefined;
    await page.keyboard.press("Enter");
    await expect(row(page, "Tentativa que falha").getByTestId("edited-mark")).toBeVisible({ timeout: 20_000 });
  });

  test("apagar para todos: falha mostra 'Tentar de novo' e não apaga; sucesso usa o JID real e fica pendente até o eco", async ({ page, request }) => {
    test.setTimeout(120_000);
    await open(page);
    await send(page, "Apague para todos");
    fake.behavior.fail = (req) => (req.path.includes("/chat/deleteMessageForEveryone/") ? 500 : null);
    let menu = await openMenu(page, "Apague para todos");
    await menu.getByTestId("action-delete-all").click();
    await page.locator("dialog[open]").getByRole("button", { name: "Apagar para todos" }).click();
    await expect(page.locator("dialog[open]").getByRole("button", { name: "Tentar de novo" })).toBeVisible({ timeout: 20_000 });
    expect(messageField("Apague para todos", "coalesce(deleted_at::text, 'nunca')")).toBe("nunca");

    fake.behavior.fail = undefined;
    await page.locator("dialog[open]").getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByTestId("message-deleted")).toBeVisible({ timeout: 20_000 });
    const deletes = requestsTo("/chat/deleteMessageForEveryone/");
    expect(deletes[deletes.length - 1].body).toMatchObject({ remoteJid: REAL_JID, fromMe: true });
    const deleted = page.locator('[data-deleted="true"]').first();
    await expect(deleted.getByTestId("wa-pending")).toBeVisible();

    const externalId = queryLocalSql(`select external_message_id from public.messages where conversation_id = '${conversation}' and deleted_at is not null limit 1;`);
    await post(request, { key: key("ECO-REVOKE-1", true), message: { protocolMessage: { type: "REVOKE", key: key(externalId, true) } }, messageTimestamp: Math.floor(Date.now() / 1000) });
    await expect.poll(() => queryLocalSql(`select coalesce(wa_pending_action, 'nenhuma') from public.messages where external_message_id = '${externalId}';`)).toBe("nenhuma");
    menu = page.locator("body");
    await expect(menu).toBeVisible();
  });

  test("edição e exclusão feitas no CELULAR chegam ao ImobFlux (marca 'editada', histórico do dono, apagada)", async ({ page, request }) => {
    test.setTimeout(120_000);
    await phoneText(request, { text: "Mensagem do celular errada", fromMe: true, id: "PH-EDIT-1" });
    await post(request, {
      key: key("PH-EDIT-EVENT", true),
      message: { deviceSentMessage: { destinationJid: REAL_JID, message: { protocolMessage: { type: 14, key: key("PH-EDIT-1", true), editedMessage: { conversation: "Mensagem do celular corrigida" }, timestampMs: Date.now() } } } },
      messageTimestamp: Math.floor(Date.now() / 1000),
    }, "MESSAGES_EDITED");
    await open(page);
    const edited = row(page, "Mensagem do celular corrigida");
    await expect(edited).toBeVisible();
    await expect(edited.getByTestId("edited-mark")).toBeVisible();
    await expect(edited.getByTestId("wa-pending")).toHaveCount(0);
    expect(queryLocalSql("select count(*) from public.message_edits where source = 'whatsapp';")).toBe("1");
    const menu = await openMenu(page, "Mensagem do celular corrigida");
    await menu.getByTestId("action-history").click();
    await expect(page.getByTestId("history-edit").first()).toContainText("celular");
    await page.keyboard.press("Escape");

    await phoneText(request, { text: "Apagada pelo celular", fromMe: true, id: "PH-DEL-1" });
    await post(request, { key: key("PH-DEL-EVENT", true), message: { protocolMessage: { type: "REVOKE", key: key("PH-DEL-1", true) } }, messageTimestamp: Math.floor(Date.now() / 1000) });
    await open(page);
    await expect(page.getByTestId("message-deleted")).toHaveCount(2);
    expect(queryLocalSql("select count(*) from public.messages where external_message_id = 'PH-DEL-1' and deleted_at is not null and deleted_source = 'whatsapp';")).toBe("1");
  });

  test("resposta feita no CELULAR mostra a citação (contextInfo na mensagem e no nível do evento)", async ({ page, request }) => {
    test.setTimeout(120_000);
    await open(page);
    await send(page, "Pergunta do ImobFlux");
    const ours = messageField("Pergunta do ImobFlux", "external_message_id");
    await post(request, {
      key: key("PH-REPLY-1", true),
      message: { extendedTextMessage: { text: "Resposta pelo celular A", contextInfo: { stanzaId: ours, participant: REAL_JID, quotedMessage: { conversation: "Pergunta do ImobFlux" } } } },
      messageTimestamp: Math.floor(Date.now() / 1000),
    });
    await post(request, {
      key: key("PH-REPLY-2", true),
      message: { conversation: "Resposta pelo celular B" },
      contextInfo: { stanzaId: ours, quotedMessage: { conversation: "Pergunta do ImobFlux" } },
      messageTimestamp: Math.floor(Date.now() / 1000),
    });
    await open(page);
    await expect(row(page, "Resposta pelo celular A").getByTestId("reply-quote")).toContainText("Pergunta do ImobFlux");
    await expect(row(page, "Resposta pelo celular B").getByTestId("reply-quote")).toContainText("Pergunta do ImobFlux");
    // a original não existe no ImobFlux: usa o trecho que veio no evento
    await post(request, {
      key: key("PH-REPLY-3", true),
      message: { extendedTextMessage: { text: "Resposta a uma antiga", contextInfo: { stanzaId: "NAO-EXISTE", quotedMessage: { conversation: "Mensagem antiga do evento" } } } },
      messageTimestamp: Math.floor(Date.now() / 1000),
    });
    await open(page);
    await expect(row(page, "Resposta a uma antiga").getByTestId("reply-quote")).toContainText("Mensagem antiga do evento");
  });

  test("reações: o ImobFlux reage com o JID real; a do celular SUBSTITUI (uma só); clicar de novo remove e não deixa fantasma", async ({ page, request }) => {
    test.setTimeout(150_000);
    await open(page);
    const menu = await openMenu(page, "Oi, tudo bem?");
    await menu.getByTestId("action-react").click();
    await page.getByTestId("emoji-quick").first().click();
    await expect.poll(() => requestsTo("/message/sendReaction/").length).toBe(1);
    const reactions = requestsTo("/message/sendReaction/");
    expect(reactions[0].body).toMatchObject({ key: { remoteJid: REAL_JID, fromMe: false }, reaction: "👍" });
    const chips = row(page, "Oi, tudo bem?").getByTestId("message-reactions").getByRole("button");
    await expect(chips).toHaveCount(1);

    // O celular da conta reage com outro emoji: substitui (antes ficavam duas, "como duas pessoas").
    const target = messageField("Oi, tudo bem?", "external_message_id");
    await post(request, { key: key("PH-REACT-1", true), message: { reactionMessage: { key: key(target, false), text: "❤️" } }, messageTimestamp: Math.floor(Date.now() / 1000) });
    await open(page);
    await expect(row(page, "Oi, tudo bem?").getByTestId("message-reactions").getByRole("button")).toHaveCount(1);
    await expect(row(page, "Oi, tudo bem?").getByTestId("message-reactions")).toContainText("❤️");
    expect(queryLocalSql("select count(*) from public.message_reactions;")).toBe("1");

    // Clicar no ❤️ (que é da nossa conta) remove: envia reação vazia e some.
    fake.reset();
    fake.behavior.jidFor = (digits) => (digits === "5582999994001" ? REAL_JID : `${digits}@s.whatsapp.net`);
    await row(page, "Oi, tudo bem?").getByTestId("message-reactions").getByRole("button").click();
    await expect.poll(() => requestsTo("/message/sendReaction/").length).toBe(1);
    expect(requestsTo("/message/sendReaction/")[0].body.reaction).toBe("");
    await expect(row(page, "Oi, tudo bem?").getByTestId("message-reactions")).toHaveCount(0);
    expect(queryLocalSql("select count(*) from public.message_reactions;")).toBe("0");

    // Reação do cliente continua separada da nossa.
    await post(request, { key: { remoteJid: REAL_JID, fromMe: false, id: "CL-REACT-1" }, message: { reactionMessage: { key: key(target, false), text: "😂" } }, messageTimestamp: Math.floor(Date.now() / 1000) });
    await open(page);
    await expect(row(page, "Oi, tudo bem?").getByTestId("message-reactions")).toContainText("😂");
  });

  test("menu da mensagem: todos os itens ficam visíveis e clicáveis sem rolar a página (1440, janela baixa e 390)", async ({ browser, request }) => {
    test.setTimeout(240_000);
    for (let i = 0; i < 18; i += 1) await phoneText(request, { text: `Mensagem de enchimento ${i}`, pushName: "Cliente Real Jid", id: `FILL-${i}`, fromMe: i % 2 === 0 });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1440, height: 520 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000 });
      const page = await context.newPage();
      await loginAsDemoOwner(page);
      await open(page);
      // última mensagem (fim da lista) e uma do meio
      for (const text of ["Mensagem de enchimento 17", "Mensagem de enchimento 8"]) {
        const target = row(page, text);
        await target.scrollIntoViewIfNeeded();
        await target.hover();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await target.getByTestId("message-menu-button").click();
        const menu = page.getByTestId("message-menu");
        await expect(menu).toBeVisible();
        const items = menu.getByRole("menuitem");
        const count = await items.count();
        expect(count).toBeGreaterThanOrEqual(3);
        const box = await menu.boundingBox();
        expect(box, `${viewport.width}x${viewport.height} ${text}`).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
        // se o menu rola por dentro (janela muito baixa), o último item chega à tela rolando SÓ o menu
        const last = items.last();
        await last.scrollIntoViewIfNeeded();
        const lastBox = await last.boundingBox();
        expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
        // clicável: o primeiro item ("Responder") age
        await items.first().click();
        await expect(menu).toHaveCount(0);
        await page.getByLabel("Digitar mensagem de texto").press("Escape");
      }
      await context.close();
    }
  });

  test("nota interna: o autor vê Editar e Apagar na nota e no painel do cliente; o dono só Apagar; nada vai ao WhatsApp", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const attendantContext = await browser.newContext();
    const attendant = await attendantContext.newPage();
    await loginAsDemoAttendant(attendant);
    await open(attendant);
    const sendsBefore = fake.requests.length;
    await attendant.getByRole("button", { name: "Nota interna" }).click();
    await attendant.getByLabel("Digitar nota interna (apenas CRM)").fill("Combinar visita para o sábado");
    await attendant.keyboard.press("Enter");
    const inline = attendant.getByTestId("internal-note").filter({ hasText: "Combinar visita" });
    await expect(inline).toBeVisible();
    // botões escritos na própria nota
    await expect(inline.getByTestId("note-edit")).toContainText("Editar");
    await expect(inline.getByTestId("note-delete")).toContainText("Apagar");

    // painel do cliente ("cartão Nota interna")
    await attendant.getByLabel("Abrir dados do cliente").click();
    const card = attendant.getByTestId("context-note").filter({ hasText: "Combinar visita" });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("context-note-edit")).toContainText("Editar");
    await expect(card.getByTestId("context-note-delete")).toContainText("Apagar");
    await card.getByTestId("context-note-edit").click();
    await attendant.getByTestId("context-note-input").fill("Combinar visita para o domingo");
    await attendant.getByTestId("context-note-save").click();
    await expect(attendant.getByTestId("context-note").filter({ hasText: "para o domingo" })).toBeVisible();
    await expect(attendant.getByTestId("context-note").filter({ hasText: "para o domingo" })).toContainText("editada");
    await attendant.keyboard.press("Escape");
    await expect(attendant.getByTestId("internal-note").filter({ hasText: "para o domingo" })).toBeVisible();

    // o dono (não é o autor): só Apagar, com confirmação
    await open(page);
    await page.getByLabel("Abrir dados do cliente").click();
    const ownerCard = page.getByTestId("context-note").filter({ hasText: "para o domingo" });
    await expect(ownerCard).toBeVisible();
    await expect(ownerCard.getByTestId("context-note-edit")).toHaveCount(0);
    await ownerCard.getByTestId("context-note-delete").click();
    await expect(page.locator("dialog[open]")).toContainText("Apagar esta nota?");
    await page.locator("dialog[open]").getByRole("button", { name: "Cancelar" }).click();
    await expect(ownerCard).toBeVisible();
    await ownerCard.getByTestId("context-note-delete").click();
    await page.locator("dialog[open]").getByRole("button", { name: "Apagar nota" }).click();
    await expect(page.getByTestId("context-note").filter({ hasText: "para o domingo" })).toHaveCount(0);
    expect(fake.requests.length - sendsBefore).toBe(0);
    expect(queryLocalSql("select count(*) from public.messages where text_content like '%Combinar visita%';")).toBe("0");
    await attendantContext.close();
  });
});
