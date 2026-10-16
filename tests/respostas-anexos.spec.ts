import { expect, test, type Browser, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoAttendant, loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Respostas rápidas com anexo: criar com arquivos, limites e recusas, usar na conversa (texto + bandeja, sem enviar), remover
// da bandeja antes de enviar, envio pela fila normal, permissões por papel e limpeza do Storage ao apagar.

const FAKE_PORT = 3099;
const JID = "5582988880601@s.whatsapp.net";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const pdf = (size: number) => Buffer.concat([Buffer.from("%PDF-1.4\n% teste\n"), Buffer.alloc(Math.max(0, size - 17), 0x20)]);
const exe = (size: number) => Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(size - 4, 3)]);

let fake: FakeEvolution;
let conversation = "";

const mediaRequests = () => fake.requests.filter((request) => request.path.includes("/message/sendMedia/"));
const textRequests = () => fake.requests.filter((request) => request.path.includes("/message/sendText/"));
const outgoingCount = () =>
  Number(queryLocalSql(`select count(*) from public.messages where conversation_id = '${conversation}' and direction = 'outgoing';`));
const storedFiles = () =>
  Number(queryLocalSql("select count(*) from storage.objects where bucket_id = 'whatsapp-media' and name like '%/quick-replies/%';"));
const attachmentRows = (title: string) =>
  Number(
    queryLocalSql(
      `select count(*) from public.quick_reply_attachments a join public.quick_replies r on r.id = a.quick_reply_id where r.title = '${title}';`,
    ),
  );

async function newPage(browser: Browser, as: "owner" | "attendant"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (as === "owner") await loginAsDemoOwner(page);
  else await loginAsDemoAttendant(page);
  return page;
}

async function openNewReply(page: Page, title: string, body: string) {
  await page.goto("/configuracoes/respostas-rapidas");
  await page.getByRole("button", { name: "Nova resposta" }).first().click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Título").fill(title);
  await dialog.getByLabel("Texto da mensagem").fill(body);
  return dialog;
}

async function useReplyInConversation(page: Page, title: string) {
  await page.goto(`/conversas/${conversation}`);
  const box = page.getByLabel("Digitar mensagem de texto");
  await expect(box).toBeVisible();
  await page.getByTestId("quick-replies-button").click();
  const panel = page.getByTestId("quick-replies-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: new RegExp(title) }).first().click();
  return box;
}

test.describe.configure({ mode: "serial" });

test.describe("Respostas rápidas com anexo", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Oi, pode mandar a tabela?", pushName: "Cliente Tabela" });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(() => fake.reset());

  test("aquecimento", async ({ browser }) => {
    test.setTimeout(240_000);
    const owner = await newPage(browser, "owner");
    await owner.goto("/configuracoes/respostas-rapidas");
    await owner.goto(`/conversas/${conversation}`);
    await owner.context().close();
  });

  test("o dono cria uma resposta com 2 arquivos; recusa .exe e passa de 5; o clipe mostra a quantidade", async ({ browser }) => {
    test.setTimeout(180_000);
    const owner = await newPage(browser, "owner");
    const dialog = await openNewReply(owner, "Enviar tabela", "Olá {{nome}}, segue a tabela de preços.");
    const input = dialog.getByTestId("quick-reply-file-input");

    await input.setInputFiles([{ name: "programa.exe", mimeType: "application/octet-stream", buffer: exe(2000) }]);
    await expect(dialog.getByText(/programa\.exe/)).toBeVisible();
    await expect(dialog.getByTestId("quick-reply-attachment-new")).toHaveCount(0);

    await input.setInputFiles([
      { name: "foto.png", mimeType: "image/png", buffer: PNG },
      { name: "tabela.pdf", mimeType: "application/pdf", buffer: pdf(20_000) },
    ]);
    await expect(dialog.getByTestId("quick-reply-attachment-new")).toHaveCount(2);
    await expect(dialog.getByText("Arquivos anexados (2 de 5)")).toBeVisible();

    // passando do limite de 5
    await input.setInputFiles(
      [1, 2, 3, 4].map((n) => ({ name: `extra${n}.pdf`, mimeType: "application/pdf", buffer: pdf(2000 + n) })),
    );
    await expect(dialog.getByTestId("quick-reply-attachment-new")).toHaveCount(5);
    await expect(dialog.getByText("Cada resposta aceita até 5 arquivos.")).toBeVisible();
    // tira os 3 extras: ficam foto.png e tabela.pdf
    for (const name of ["extra3.pdf", "extra2.pdf", "extra1.pdf"]) {
      await dialog.getByRole("button", { name: `Remover ${name}` }).click();
    }
    await expect(dialog.getByTestId("quick-reply-attachment-new")).toHaveCount(2);

    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(owner.locator("dialog[open]")).toHaveCount(0, { timeout: 60_000 });
    const card = owner.getByTestId("manager-reply").filter({ hasText: "Enviar tabela" });
    await expect(card.getByTestId("quick-reply-has-files")).toContainText("2");
    expect(attachmentRows("Enviar tabela")).toBe(2);
    expect(storedFiles()).toBe(2);
    await owner.context().close();
  });

  test("usar na conversa: o texto entra na caixa, os arquivos entram na bandeja e NADA é enviado", async ({ browser }) => {
    test.setTimeout(180_000);
    const owner = await newPage(browser, "owner");
    const before = outgoingCount();
    const box = await useReplyInConversation(owner, "Enviar tabela");
    await expect(box).toHaveValue(/segue a tabela de preços\./);
    await expect(box).not.toHaveValue(/\{\{nome\}\}/);
    await expect(owner.getByTestId("outgoing-item")).toHaveCount(2, { timeout: 30_000 });
    await expect(owner.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(2, { timeout: 60_000 });
    await expect(owner.getByTestId("outgoing-item").filter({ hasText: "foto.png" })).toBeVisible();
    await expect(owner.getByTestId("outgoing-item").filter({ hasText: "tabela.pdf" })).toBeVisible();
    await owner.waitForTimeout(1500);
    expect(outgoingCount()).toBe(before);
    expect(mediaRequests()).toHaveLength(0);
    expect(textRequests()).toHaveLength(0);
    await owner.context().close();
  });

  test("remover um arquivo da bandeja antes de enviar; envio sai pela fila normal (arquivo, depois texto)", async ({ browser }) => {
    test.setTimeout(180_000);
    const owner = await newPage(browser, "owner");
    const box = await useReplyInConversation(owner, "Enviar tabela");
    await expect(owner.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(2, { timeout: 60_000 });
    await owner.getByRole("button", { name: /Remover foto\.png/ }).first().click();
    await expect(owner.getByTestId("outgoing-item")).toHaveCount(1);
    // o texto continua editável
    await box.fill("Segue a tabela de preços, conforme combinamos.");
    await owner.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => mediaRequests().length, { timeout: 60_000 }).toBe(1);
    await expect.poll(() => textRequests().length, { timeout: 60_000 }).toBe(1);
    expect(JSON.stringify(mediaRequests()[0])).toContain("tabela.pdf");
    // o arquivo original da resposta continua guardado para os próximos usos
    expect(attachmentRows("Enviar tabela")).toBe(2);
    expect(storedFiles()).toBe(2);
    await owner.context().close();
  });

  test("atendente usa a resposta do dono (arquivos entram na bandeja), mas não edita os anexos dela", async ({ browser }) => {
    test.setTimeout(180_000);
    const attendant = await newPage(browser, "attendant");
    await useReplyInConversation(attendant, "Enviar tabela");
    await expect(attendant.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(2, { timeout: 60_000 });
    await attendant.goto("/configuracoes/respostas-rapidas");
    await expect(attendant.getByRole("button", { name: "Ações de Enviar tabela" })).toHaveCount(0);
    await attendant.context().close();
  });

  test("atendente anexa na própria resposta; o dono remove um anexo dela; apagar a resposta limpa o Storage", async ({ browser }) => {
    test.setTimeout(240_000);
    const attendant = await newPage(browser, "attendant");
    const dialog = await openNewReply(attendant, "Documentos do atendente", "Envie os documentos, por favor.");
    await dialog.getByTestId("quick-reply-file-input").setInputFiles([{ name: "lista.pdf", mimeType: "application/pdf", buffer: pdf(9000) }]);
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(attendant.locator("dialog[open]")).toHaveCount(0, { timeout: 60_000 });
    expect(attachmentRows("Documentos do atendente")).toBe(1);
    expect(storedFiles()).toBe(3);
    await attendant.context().close();

    const owner = await newPage(browser, "owner");
    await owner.goto("/configuracoes/respostas-rapidas");
    await owner.getByRole("button", { name: "Ações de Documentos do atendente" }).click();
    await owner.getByRole("menuitem", { name: "Editar" }).click();
    const edit = owner.locator("dialog[open]");
    await expect(edit.getByTestId("quick-reply-attachment")).toHaveCount(1);
    await edit.getByRole("button", { name: "Remover lista.pdf" }).click();
    await edit.getByRole("button", { name: "Salvar" }).click();
    await expect(owner.locator("dialog[open]")).toHaveCount(0, { timeout: 60_000 });
    expect(attachmentRows("Documentos do atendente")).toBe(0);
    expect(storedFiles()).toBe(2);

    // apagar a resposta com anexos limpa os arquivos
    await owner.getByRole("button", { name: "Ações de Enviar tabela" }).click();
    await owner.getByRole("menuitem", { name: "Apagar" }).click();
    await owner.locator("dialog[open]").getByRole("button", { name: "Apagar" }).click();
    await expect(owner.getByTestId("manager-reply").filter({ hasText: "Enviar tabela" })).toHaveCount(0);
    expect(attachmentRows("Enviar tabela")).toBe(0);
    expect(storedFiles()).toBe(0);
    await owner.context().close();
  });
});
