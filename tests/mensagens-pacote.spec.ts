import { expect, test, type Locator, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import {
  loginAsDemoAttendant,
  loginAsDemoOwner,
  queryLocalSql,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";
import { activeInstance, ingestText, postWebhook } from "./helpers/webhook";

// Pacote de mensagens: responder, editar, apagar, encaminhar, reações, áudio, não lida/fixar, busca e nota interna.
// A Evolution é SIMULADA (tests/helpers/fake-evolution.ts): nada sai para a internet.

const FAKE_PORT = 3099;
const JID_MAIN = "5582988887801@s.whatsapp.net";
const JID_SECOND = "5582988887802@s.whatsapp.net";
const extraJid = (n: number) => `558298888780${n}@s.whatsapp.net`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let fake: FakeEvolution;
let main = "";
let second = "";

const history = (page: Page) => page.getByLabel("Histórico de mensagens");
const row = (page: Page, text: string) => history(page).locator("[data-message-id]").filter({ hasText: text }).first();
const requestsTo = (fragment: string) => fake.requests.filter((request) => request.path.includes(fragment));
const externalId = (text: string, conversation = main) =>
  queryLocalSql(`select external_message_id from public.messages where conversation_id = '${conversation}' and text_content = '${text}' limit 1;`);
const messageId = (text: string, conversation = main) =>
  queryLocalSql(`select id from public.messages where conversation_id = '${conversation}' and text_content = '${text}' limit 1;`);

async function open(page: Page, conversation = main) {
  await page.goto(`/conversas/${conversation}`);
  await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
  // Os cliques só valem depois de a página hidratar.
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

async function menu(page: Page, text: string): Promise<Locator> {
  const target = row(page, text);
  await target.hover();
  await target.getByTestId("message-menu-button").click();
  // O menu fica num portal (fora da bolha, sempre dentro da tela): as ações são procuradas nele.
  const menuBox = page.getByTestId("message-menu");
  await expect(menuBox).toBeVisible();
  return menuBox;
}

async function send(page: Page, text: string) {
  await page.getByLabel("Digitar mensagem de texto").fill(text);
  await page.keyboard.press("Enter");
  await expect(history(page).getByText(text).first()).toBeVisible();
  await expect(history(page).getByTestId("message-sending")).toHaveCount(0, { timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Pacote de mensagens", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    main = await ingestText(request, { jid: JID_MAIN, text: "Olá, quero um apartamento na Ponta Verde", pushName: "Cliente Pacote" });
    second = await ingestText(request, { jid: JID_SECOND, text: "Oi, sou o segundo cliente", pushName: "Segundo Cliente" });
    for (let n = 3; n <= 7; n += 1) await ingestText(request, { jid: extraJid(n), text: `Oi, sou o cliente ${n}`, pushName: `Cliente Extra ${n}` });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(async ({ page }) => {
    fake.reset();
    await loginAsDemoOwner(page);
  });

  test("responder: cartão de citação, quoted na Evolution, citação na bolha e clique rola até a original", async ({ page }) => {
    await open(page);
    const customer = await menu(page, "quero um apartamento");
    await customer.getByTestId("action-reply").click();
    await expect(page.getByTestId("reply-card")).toContainText("Respondendo a");
    await expect(page.getByTestId("reply-card")).toContainText("quero um apartamento");

    // Esc cancela; o X também.
    await page.getByLabel("Digitar mensagem de texto").press("Escape");
    await expect(page.getByTestId("reply-card")).toHaveCount(0);

    const again = await menu(page, "quero um apartamento");
    await again.getByTestId("action-reply").click();
    await send(page, "Claro, temos opções!");
    await expect(page.getByTestId("reply-card")).toHaveCount(0);

    const sends = requestsTo("/message/sendText/");
    expect(sends).toHaveLength(1);
    expect(sends[0].body.quoted).toMatchObject({
      key: { id: externalId("Olá, quero um apartamento na Ponta Verde"), remoteJid: JID_MAIN, fromMe: false },
    });

    // A citação aparece na bolha enviada e fica gravada.
    const mine = row(page, "Claro, temos opções!");
    await expect(mine.getByTestId("reply-quote")).toContainText("quero um apartamento");
    expect(queryLocalSql(`select reply_to_message_id is not null from public.messages where id = '${messageId("Claro, temos opções!")}';`)).toBe("t");

    // Clicar na citação leva até a mensagem original e a destaca.
    await mine.getByTestId("reply-quote").click();
    await expect(row(page, "quero um apartamento")).toHaveClass(/ring-2/);
  });

  test("resposta recebida do cliente (contextInfo) aparece com a citação", async ({ page, request }) => {
    const ours = externalId("Claro, temos opções!");
    const response = await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: {
        key: { remoteJid: JID_MAIN, fromMe: false, id: `WH-REPLY-${Date.now()}` },
        pushName: "Cliente Pacote",
        message: {
          extendedTextMessage: { text: "Quero ver a de 3 quartos", contextInfo: { stanzaId: ours, quotedMessage: { conversation: "Claro, temos opções!" } } },
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(response.ok()).toBe(true);
    await open(page);
    const bubble = row(page, "Quero ver a de 3 quartos");
    await expect(bubble.getByTestId("reply-quote")).toContainText("Claro, temos opções!");
  });

  test("editar: sucesso (updateMessage), 'editada', histórico guardado, falha da Evolution mantém o original e a janela de 15 min", async ({ page }) => {
    await open(page);
    await send(page, "Preço de 500 mil");
    const before = row(page, "Preço de 500 mil");
    await expect(before).toBeVisible();

    // Falha da Evolution: o texto original continua e o motivo aparece.
    fake.behavior.fail = ({ path }) => (path.includes("/chat/updateMessage/") ? 400 : null);
    let target = await menu(page, "Preço de 500 mil");
    await target.getByTestId("action-edit").click();
    await expect(page.getByTestId("edit-banner")).toBeVisible();
    await page.getByLabel("Digitar mensagem de texto").fill("Preço de 450 mil");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
    await expect(page.locator("#msg-send-feedback")).toContainText("WhatsApp recusou");
    expect(queryLocalSql(`select text_content from public.messages where id = '${messageId("Preço de 500 mil")}';`)).toBe("Preço de 500 mil");

    // Sucesso.
    fake.behavior.fail = undefined;
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("edit-banner")).toHaveCount(0);
    const edits = requestsTo("/chat/updateMessage/");
    expect(edits.at(-1)?.body).toMatchObject({ text: "Preço de 450 mil", key: { fromMe: true, remoteJid: JID_MAIN } });
    const edited = row(page, "Preço de 450 mil");
    await expect(edited.getByTestId("edited-mark")).toBeVisible();
    expect(queryLocalSql(`select count(*) from public.message_edits where previous_text = 'Preço de 500 mil' and new_text = 'Preço de 450 mil';`)).toBe("1");
    expect(queryLocalSql("select count(*) from public.audit_events where action = 'message.edited';")).toBe("1");

    // Passou de 15 minutos: o menu não oferece mais "Editar".
    runLocalSql(`update public.messages set occurred_at = now() - interval '20 minutes' where id = '${messageId("Preço de 450 mil")}';`);
    await page.reload();
    target = await menu(page, "Preço de 450 mil");
    await expect(target.getByTestId("action-edit")).toHaveCount(0);
    await expect(target.getByTestId("action-delete-all")).toBeVisible();
  });

  test("editar: o atendente não vê 'Editar' nem 'Apagar para todos' na mensagem de outra pessoa", async ({ page }) => {
    // O dono envia; depois a atendente entra.
    await open(page);
    await send(page, "Mensagem do dono");
    await loginAsDemoAttendant(page);
    await open(page);
    await send(page, "Mensagem da atendente");
    // Mensagem enviada pelo dono: sem editar / apagar para todos.
    const owners = await menu(page, "Mensagem do dono");
    await expect(owners.getByTestId("action-edit")).toHaveCount(0);
    await expect(owners.getByTestId("action-delete-all")).toHaveCount(0);
    await expect(owners.getByTestId("action-reply")).toBeVisible();
    await page.keyboard.press("Escape");
    // Na própria mensagem, sim.
    const mine = await menu(page, "Mensagem da atendente");
    await expect(mine.getByTestId("action-edit")).toBeVisible();
    await expect(mine.getByTestId("action-delete-all")).toBeVisible();
  });

  test("apagar para todos: DELETE na Evolution, 'Esta mensagem foi apagada', original só em auditoria; falha não apaga", async ({ page }) => {
    await open(page);
    await send(page, "Apague isto para todos");
    fake.behavior.fail = ({ path }) => (path.includes("/chat/deleteMessageForEveryone/") ? 500 : null);
    let target = await menu(page, "Apague isto para todos");
    await target.getByTestId("action-delete-all").click();
    await page.getByRole("button", { name: "Apagar para todos" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("WhatsApp");
    expect(queryLocalSql(`select deleted_at is null from public.messages where id = '${messageId("Apague isto para todos")}';`)).toBe("t");
    await page.getByRole("button", { name: "Cancelar" }).click();

    fake.behavior.fail = undefined;
    target = await menu(page, "Apague isto para todos");
    await target.getByTestId("action-delete-all").click();
    await page.getByRole("button", { name: "Apagar para todos" }).click();
    await expect(history(page).getByTestId("message-deleted")).toHaveCount(1);
    const requests = requestsTo("/chat/deleteMessageForEveryone/");
    expect(requests.at(-1)?.body).toMatchObject({ fromMe: true, remoteJid: JID_MAIN });
    expect(queryLocalSql("select count(*) from public.message_deletions where original_text = 'Apague isto para todos';")).toBe("1");
    expect(queryLocalSql("select count(*) from public.audit_events where action = 'message.deleted_for_everyone';")).toBe("1");
    await page.reload();
    await expect(history(page).getByText("Apague isto para todos")).toHaveCount(0);
    await expect(history(page).getByTestId("message-deleted")).toHaveCount(1);
  });

  test("apagar para mim: confirmação, some para toda a equipe, o WhatsApp não é tocado", async ({ page }) => {
    await open(page);
    await send(page, "Esconda esta aqui");
    const before = fake.requests.length;
    const target = await menu(page, "Esconda esta aqui");
    await target.getByTestId("action-hide").click();
    await expect(page.getByRole("alertdialog")).toContainText("Isso esconde a mensagem no ImobFlux. Ela continua no WhatsApp.");
    await page.getByRole("button", { name: "Apagar para mim" }).last().click();
    await expect(history(page).getByText("Esconda esta aqui")).toHaveCount(0);
    expect(fake.requests.length - before).toBe(0);
    expect(queryLocalSql(`select hidden_at is not null from public.messages where id = '${messageId("Esconda esta aqui")}';`)).toBe("t");

    // A outra pessoa da equipe também não vê (entra a atendente na mesma janela).
    await loginAsDemoAttendant(page);
    await open(page);
    await expect(history(page).getByText("Esconda esta aqui")).toHaveCount(0);
    await expect(page.getByTestId("hidden-messages-toggle")).toHaveCount(0);
  });

  test("exclusão e edição feitas no celular/cliente chegam pelo webhook", async ({ page, request }) => {
    const mainExternal = externalId("Olá, quero um apartamento na Ponta Verde");
    // O cliente edita a própria mensagem e depois apaga outra.
    await ingestText(request, { jid: JID_MAIN, text: "Mensagem que o cliente vai apagar", id: "WH-CLIENT-DEL", pushName: "Cliente Pacote" });
    await ingestText(request, { jid: JID_MAIN, text: "Texto antes da edição do cliente", id: "WH-CLIENT-EDIT", pushName: "Cliente Pacote" });
    const edit = await postWebhook(request, {
      event: "messages.edited",
      instance: activeInstance(),
      data: {
        key: { remoteJid: JID_MAIN, fromMe: false, id: "WH-EDIT-EVENT" },
        message: { editedMessage: { message: { protocolMessage: { key: { id: "WH-CLIENT-EDIT", remoteJid: JID_MAIN }, type: "MESSAGE_EDIT", editedMessage: { conversation: "Texto depois da edição do cliente" } } } } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(edit.ok()).toBe(true);
    const revoke = await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: {
        key: { remoteJid: JID_MAIN, fromMe: false, id: "WH-REVOKE-EVENT" },
        message: { protocolMessage: { type: 0, key: { id: "WH-CLIENT-DEL", remoteJid: JID_MAIN } } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(revoke.ok()).toBe(true);
    // Eventos de mensagem desconhecida são ignorados sem erro.
    const unknown = await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: { key: { remoteJid: JID_MAIN, fromMe: false, id: "X" }, message: { protocolMessage: { type: 0, key: { id: "NAO-EXISTE" } } } },
    });
    expect(unknown.ok()).toBe(true);
    expect(mainExternal).not.toBe("");

    await open(page);
    await expect(row(page, "Texto depois da edição do cliente").getByTestId("edited-mark")).toBeVisible();
    await expect(history(page).getByText("Mensagem que o cliente vai apagar")).toHaveCount(0);
    expect(queryLocalSql("select count(*) from public.message_edits where source = 'whatsapp';")).toBe("1");
    expect(queryLocalSql("select count(*) from public.message_deletions where source = 'whatsapp';")).toBe("1");
    // Editar/apagar/reagir não contam como mensagem nova do cliente: o prazo (SLA) olha a última mensagem válida.
    expect(requestsTo("/")).toHaveLength(0);
  });

  test("reações: 6 rápidas + mais, trocar, remover, recebida do cliente sob a bolha, eco não duplica", async ({ page, request }) => {
    await open(page);
    const target = await menu(page, "Claro, temos opções!");
    await target.getByTestId("action-react").click();
    await expect(page.getByTestId("emoji-quick")).toHaveCount(6);
    await page.getByTestId("emoji-quick").first().click();
    const reactions = row(page, "Claro, temos opções!").getByTestId("message-reactions");
    await expect(reactions).toContainText("👍");
    const sent = requestsTo("/message/sendReaction/");
    expect(sent.at(-1)?.body).toMatchObject({ reaction: "👍", key: { id: externalId("Claro, temos opções!"), fromMe: true } });

    // O eco "enviada por mim" da Evolution não vira uma segunda reação.
    const echo = await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: {
        key: { remoteJid: JID_MAIN, fromMe: true, id: `ECHO-${Date.now()}` },
        message: { reactionMessage: { key: { id: externalId("Claro, temos opções!"), remoteJid: JID_MAIN, fromMe: true }, text: "👍" } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    expect(echo.ok()).toBe(true);
    expect(queryLocalSql(`select count(*) from public.message_reactions where message_id = '${messageId("Claro, temos opções!")}';`)).toBe("1");

    // Trocar pelo "mais".
    const again = await menu(page, "Claro, temos opções!");
    await again.getByTestId("action-react").click();
    await page.getByTestId("emoji-more").click();
    await page.getByTestId("emoji-grid").getByRole("button", { name: "Reagir com 🔥" }).click();
    await expect(reactions).toContainText("🔥");
    await expect(reactions).not.toContainText("👍");

    // O cliente reage: aparece junto, e remover a própria deixa só a dele.
    await postWebhook(request, {
      event: "messages.upsert",
      instance: activeInstance(),
      data: {
        key: { remoteJid: JID_MAIN, fromMe: false, id: `WH-REACT-${Date.now()}` },
        message: { reactionMessage: { key: { id: externalId("Claro, temos opções!"), remoteJid: JID_MAIN, fromMe: true }, text: "❤️" } },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    });
    await page.reload();
    await expect(reactions).toContainText("❤️");
    // Logo depois do reload a página ainda pode estar hidratando: repete o clique até a reação sumir.
    await expect(async () => {
      const chip = reactions.getByRole("button", { name: /🔥/ });
      if ((await chip.count()) > 0) await chip.click({ timeout: 2_000 });
      await expect(reactions).not.toContainText("🔥", { timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
    expect(requestsTo("/message/sendReaction/").at(-1)?.body.reaction).toBe("");
    await expect(reactions).toContainText("❤️");
  });

  test("encaminhar: busca, até 5 destinos, confirmação com quantidade, aviso de risco, falha isolada e marca 'Encaminhada'", async ({ page }) => {
    await open(page);
    const target = await menu(page, "Claro, temos opções!");
    await target.getByTestId("action-forward").click();
    const dialog = page.getByTestId("forward-dialog");
    await expect(dialog).toBeVisible();

    // Busca por nome.
    await dialog.getByTestId("forward-search").fill("Segundo");
    await expect(dialog.getByTestId("forward-option")).toHaveCount(1);
    await dialog.getByTestId("forward-option").click();
    await dialog.getByTestId("forward-search").fill("");
    // Limite de 5: a sexta opção fica bloqueada.
    const options = dialog.getByTestId("forward-option");
    await expect.poll(() => options.count()).toBeGreaterThanOrEqual(6);
    const total = await options.count();
    for (let index = 0; index < total; index += 1) {
      const option = options.nth(index);
      if ((await dialog.getByTestId("forward-selected").locator("li").count()) >= 5) break;
      if ((await option.getAttribute("aria-pressed")) === "true") continue;
      await option.click();
    }
    await expect(dialog.getByTestId("forward-selected").locator("li")).toHaveCount(5);
    await expect(dialog.locator('[data-testid="forward-option"]:disabled').first()).toBeDisabled();

    await dialog.getByTestId("forward-continue").click();
    await expect(dialog.getByTestId("forward-confirm-text")).toContainText("5");
    await expect(dialog.getByTestId("forward-risk-warning")).toContainText("bloquear");

    // Uma das destinos falha: os outros 4 saem.
    let calls = 0;
    fake.behavior.fail = ({ path }) => {
      if (!path.includes("/message/sendText/")) return null;
      calls += 1;
      return calls === 2 ? 500 : null;
    };
    await dialog.getByTestId("forward-confirm").click();
    await expect(dialog.getByTestId("forward-result")).toContainText("4 de 5");
    await expect(dialog.getByTestId("forward-failures")).toBeVisible();
    expect(requestsTo("/message/sendText/")).toHaveLength(5);
    expect(queryLocalSql("select count(*) from public.messages where forwarded and text_content = 'Claro, temos opções!';")).toBe("4");
    expect(queryLocalSql("select count(*) from public.audit_events where action = 'message.forwarded';")).toBe("4");
    await dialog.getByRole("button", { name: "Fechar" }).last().click();

    await open(page, second);
    await expect(row(page, "Claro, temos opções!").getByTestId("forwarded-mark")).toBeVisible();
  });

  test("legenda do arquivo: Enter envia, Shift+Enter quebra a linha (clipe, arrastar e Ctrl+V)", async ({ page }) => {
    await open(page);
    // Clipe + Shift+Enter (quebra) + Enter (envia).
    await page.getByTestId("file-input").setInputFiles([{ name: "casa.png", mimeType: "image/png", buffer: PNG }]);
    await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(1, { timeout: 30_000 });
    const caption = page.getByLabel("Legenda de casa.png");
    await caption.fill("primeira linha");
    await caption.press("Shift+Enter");
    await caption.pressSequentially("segunda linha");
    expect(await caption.inputValue()).toBe("primeira linha\nsegunda linha");
    expect(requestsTo("/message/sendMedia/")).toHaveLength(0);
    await caption.press("Enter");
    await expect.poll(() => requestsTo("/message/sendMedia/").length, { timeout: 30_000 }).toBe(1);
    expect(requestsTo("/message/sendMedia/")[0].body.caption).toBe("primeira linha\nsegunda linha");
    await expect(page.getByTestId("outgoing-item")).toHaveCount(0);

    // Arrastar: o arquivo entra na bandeja e Enter na legenda envia.
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["%PDF-1.4 conteúdo"], "arrastado.pdf", { type: "application/pdf" }));
      const column = document.querySelector('[data-testid="conversation-column"]') as HTMLElement;
      column.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      column.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(1, { timeout: 30_000 });
    await page.getByLabel("Legenda de arrastado.pdf").fill("contrato arrastado");
    await page.getByLabel("Legenda de arrastado.pdf").press("Enter");
    await expect.poll(() => requestsTo("/message/sendMedia/").length, { timeout: 30_000 }).toBe(2);
    expect(requestsTo("/message/sendMedia/")[1].body).toMatchObject({ mediatype: "document", caption: "contrato arrastado" });

    // Ctrl+V: a imagem colada vira anexo e Enter na legenda envia.
    await page.evaluate(() => {
      const box = document.querySelector('textarea[aria-label="Digitar mensagem de texto"]') as HTMLTextAreaElement;
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "colada.png", { type: "image/png" }));
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(1, { timeout: 30_000 });
    await page.getByLabel("Legenda de colada.png").fill("colada com legenda");
    await page.getByLabel("Legenda de colada.png").press("Enter");
    await expect.poll(() => requestsTo("/message/sendMedia/").length, { timeout: 30_000 }).toBe(3);
    expect(requestsTo("/message/sendMedia/")[2].body.caption).toBe("colada com legenda");
    // A caixa de mensagem continua com Enter = enviar e Shift+Enter = quebra.
    const box = page.getByLabel("Digitar mensagem de texto");
    await box.fill("linha A");
    await box.press("Shift+Enter");
    await box.pressSequentially("linha B");
    expect(await box.inputValue()).toBe("linha A\nlinha B");
  });

  test("áudio de voz: gravar, ver o tempo, ouvir antes, enviar como PTT; cancelar não envia; permissão negada é amigável", async ({ page }) => {
    await page.context().grantPermissions(["microphone"]);
    await open(page);
    await page.getByTestId("voice-start").click();
    await expect(page.getByTestId("voice-timer")).toBeVisible();
    await page.waitForTimeout(1600);
    await expect(page.getByTestId("voice-timer")).not.toContainText("0:00 /");
    // Cancelar: nada é enviado e a caixa volta.
    await page.getByTestId("voice-cancel").click();
    await expect(page.getByTestId("voice-bar")).toHaveCount(0);
    expect(requestsTo("/message/sendWhatsAppAudio/")).toHaveLength(0);

    await page.getByTestId("voice-start").click();
    await page.waitForTimeout(1600);
    await page.getByTestId("voice-stop").click();
    await expect(page.getByTestId("voice-preview")).toBeVisible();
    await page.getByTestId("voice-send").click();
    await expect.poll(() => requestsTo("/message/sendWhatsAppAudio/").length, { timeout: 40_000 }).toBe(1);
    const audio = requestsTo("/message/sendWhatsAppAudio/")[0];
    expect(audio.body).toMatchObject({ encoding: true });
    expect(String(audio.body.audio)).toMatch(/\/object\/sign\/whatsapp-media\/.+\?token=/);
    expect(audio.download?.status).toBe(200);
    expect(audio.download?.bytes ?? 0).toBeGreaterThan(500);
    await expect(history(page).getByTestId("message-sending")).toHaveCount(0, { timeout: 30_000 });
    expect(queryLocalSql("select count(*) from public.attachments where mime_type like 'audio/%' and original_file_name like 'voz.%';")).toBe("1");

    // Permissão negada: mensagem amigável, sem quebrar.
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("negado", "NotAllowedError"));
    });
    await page.reload();
    await page.getByTestId("voice-start").click();
    await expect(page.locator("#msg-send-feedback")).toContainText("permissão foi negada");
  });

  test("não lida e fixar: marcar como não lida e abrir limpa; fixar vai ao topo, limite de 5, só para mim", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Marcar como não lida" }).click();
    await expect(page.locator(`#conv-card-${main} [title="Não lida"]`)).toBeVisible();
    await open(page, second);
    await open(page);
    await expect(page.locator(`#conv-card-${main} [title="Não lida"]`)).toHaveCount(0);

    // Fixar a conversa "second" (a mais antiga da lista) a leva ao topo, com o ícone.
    await open(page, second);
    await page.getByTestId("conversation-pin-toggle").click();
    await expect(page.locator(`#conv-card-${second} [data-testid="pinned-mark"]`)).toBeVisible();
    await expect(page.locator('[id^="conv-card-"]').first()).toHaveAttribute("id", `conv-card-${second}`);

    // Fixação pessoal: a outra pessoa não vê o pin.
    await loginAsDemoAttendant(page);
    await page.goto("/conversas");
    await expect(page.locator('[id^="conv-card-"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="pinned-mark"]')).toHaveCount(0);
    await loginAsDemoOwner(page);

    // Limite de 5.
    const ids = queryLocalSql("select id from public.conversations where conversation_type = 'individual' and id <> '" + second + "' order by created_at limit 4;").split("\n");
    for (const id of ids) {
      await open(page, id);
      await page.getByTestId("conversation-pin-toggle").click();
      await expect(page.getByTestId("conversation-pin-toggle")).toHaveAttribute("aria-pressed", "true");
    }
    const six = queryLocalSql("select id from public.conversations where conversation_type = 'individual' and id <> all (string_to_array('" + [second, ...ids].join(",") + "', ',')::uuid[]) limit 1;");
    await open(page, six);
    await page.getByTestId("conversation-pin-toggle").click();
    await expect(page.getByTestId("action-notice")).toContainText("5 conversas");
  });

  test("busca na conversa: destaca, conta, setas, carrega mensagens antigas e não acha escondidas", async ({ page }) => {
    // 120 mensagens antigas só com a palavra rara no começo do histórico.
    runLocalSql(`
      insert into public.messages (workspace_id, channel_connection_id, conversation_id, external_message_id, direction, origin, sender_contact_point_id, text_content, status, occurred_at, external_created_at, received_at)
      select c.workspace_id, c.channel_connection_id, c.id, 'bulk-' || n, 'incoming', 'whatsapp',
             (select m.sender_contact_point_id from public.messages m where m.conversation_id = c.id and m.direction = 'incoming' limit 1),
             case when n = 1 then 'documento raro de escritura' else 'mensagem de enchimento ' || n end, 'received', now() - interval '3 days' + (n || ' minutes')::interval,
             now() - interval '3 days' + (n || ' minutes')::interval, now() - interval '3 days' + (n || ' minutes')::interval
      from public.conversations c, generate_series(1, 120) as n where c.id = '${second}';
    `);
    await open(page, second);
    await page.getByTestId("conversation-search-toggle").click();
    await page.getByTestId("conversation-search-input").fill("escritura");
    await expect(page.getByTestId("conversation-search-count")).toContainText("1 de 1", { timeout: 30_000 });
    // Carregou o histórico até a mensagem e a destacou.
    await expect(history(page).getByTestId("search-mark").first()).toBeVisible({ timeout: 30_000 });
    await expect(row(page, "documento raro de escritura")).toHaveClass(/ring-2/);

    // Várias ocorrências: contagem e setas.
    await page.getByTestId("conversation-search-input").fill("enchimento");
    await expect(page.getByTestId("conversation-search-count")).toContainText("1 de 119", { timeout: 30_000 });
    await page.getByTestId("search-older").click();
    await expect(page.getByTestId("conversation-search-count")).toContainText("2 de 119");
    await page.getByTestId("search-newer").click();
    await expect(page.getByTestId("conversation-search-count")).toContainText("1 de 119");

    // Sem resultado, e escondidas não aparecem.
    await page.getByTestId("conversation-search-input").fill("zzzinexistente");
    await expect(page.getByTestId("conversation-search-count")).toContainText("Nenhum resultado");
    await open(page);
    await page.getByTestId("conversation-search-toggle").click();
    await page.getByTestId("conversation-search-input").fill("Esconda esta aqui");
    await expect(page.getByTestId("conversation-search-count")).toContainText("Nenhum resultado", { timeout: 15_000 });
    await page.getByTestId("search-close").click();
    await expect(page.getByTestId("conversation-search")).toHaveCount(0);
  });

  test("nota interna: estilo próprio, nunca vai ao WhatsApp, não conta no prazo, autor edita, dono apaga qualquer, entra na busca", async ({ page }) => {
    // Como atendente, escreve a nota.
    const attendant = page;
    await loginAsDemoAttendant(attendant);
    await open(attendant);
    const slaBefore = queryLocalSql(`select coalesce(max(occurred_at)::text, '') from public.messages where conversation_id = '${main}';`);
    const messagesBefore = queryLocalSql(`select count(*) from public.messages where conversation_id = '${main}';`);
    const sendsBefore = fake.requests.length;
    await attendant.getByRole("button", { name: "Nota interna" }).click();
    await expect(attendant.getByTestId("note-hint")).toContainText(/só a equipe vê/i);
    await attendant.getByLabel("Digitar nota interna (apenas CRM)").fill("Cliente prefere visita no sábado");
    await attendant.keyboard.press("Enter");
    const note = attendant.getByTestId("internal-note").filter({ hasText: "visita no sábado" });
    await expect(note).toBeVisible();
    await expect(note).toContainText("Só a equipe vê");
    // Nenhuma chamada à Evolution, nenhuma mensagem criada, hora da última mensagem (base do prazo) inalterada.
    expect(fake.requests.length - sendsBefore).toBe(0);
    expect(queryLocalSql(`select count(*) from public.messages where conversation_id = '${main}';`)).toBe(messagesBefore);
    expect(queryLocalSql(`select coalesce(max(occurred_at)::text, '') from public.messages where conversation_id = '${main}';`)).toBe(slaBefore);

    // O autor edita.
    await note.getByTestId("note-edit").click();
    await attendant.getByLabel("Editar nota interna").fill("Cliente prefere visita no domingo");
    await attendant.getByTestId("note-save").click();
    await expect(attendant.getByTestId("internal-note").filter({ hasText: "visita no domingo" })).toBeVisible();
    await expect(attendant.getByTestId("internal-note").filter({ hasText: "visita no domingo" })).toContainText("editada");

    // Entra na busca da conversa.
    await attendant.getByTestId("conversation-search-toggle").click();
    await attendant.getByTestId("conversation-search-input").fill("domingo");
    await expect(attendant.getByTestId("conversation-search-count")).toContainText("1 de 1", { timeout: 15_000 });

    // O dono vê a nota, mas não edita (não é o autor); apaga.
    await loginAsDemoOwner(page);
    await open(page);
    const ownerView = page.getByTestId("internal-note").filter({ hasText: "visita no domingo" });
    await expect(ownerView).toBeVisible();
    await expect(ownerView.getByTestId("note-edit")).toHaveCount(0);
    await ownerView.getByTestId("note-delete").click();
    await page.locator("dialog[open]").getByRole("button", { name: "Apagar nota" }).click();
    await expect(page.getByTestId("internal-note").filter({ hasText: "visita no domingo" })).toHaveCount(0);
    expect(queryLocalSql("select count(*) from public.audit_events where action = 'conversation.note_deleted';")).toBe("1");
    expect(fake.requests.length - sendsBefore).toBe(0);
  });
});
