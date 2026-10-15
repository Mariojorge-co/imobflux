import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

const JID = "5582988887702@s.whatsapp.net";
const FAKE_PORT = 3099;
const MB = 1024 * 1024;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const pdf = (size: number) => Buffer.concat([Buffer.from("%PDF-1.4\n% teste\n"), Buffer.alloc(Math.max(0, size - 17), 0x20)]);
const rar = (size: number) => Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), Buffer.alloc(size - 7, 1)]);
const mp4 = (size: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), Buffer.alloc(size - 12, 2)]);
const exe = (size: number) => Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(size - 4, 3)]);

let fake: FakeEvolution;
let conversation = "";

const mediaRequests = () => fake.requests.filter((request) => request.path.includes("/message/sendMedia/"));
const allSends = () => fake.requests.filter((request) => /\/message\/send(Media|Text)\//.test(request.path));
const attachmentCount = () =>
  Number(queryLocalSql(`select count(*) from public.attachments a join public.messages m on m.id = a.message_id where m.conversation_id = '${conversation}' and m.direction = 'outgoing';`));

async function open(page: Page) {
  await loginAsDemoOwner(page);
  await page.goto(`/conversas/${conversation}`);
  await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
}

async function waitAllReady(page: Page, count: number) {
  await expect(page.getByTestId("outgoing-item")).toHaveCount(count);
  await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(count, { timeout: 60_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Envio de arquivos pelo WhatsApp", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Oi, pode mandar os documentos?", pushName: "Cliente Arquivos" });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(() => fake.reset());

  test("clipe: foto, PDF com legenda e .rar + texto — pré-visualização, upload, ordem na fila e contrato da Evolution", async ({ page }) => {
    await open(page);
    await page.getByTestId("file-input").setInputFiles([
      { name: "foto.png", mimeType: "image/png", buffer: PNG },
      { name: "contrato.pdf", mimeType: "application/pdf", buffer: pdf(20_000) },
      { name: "pacote.rar", mimeType: "application/vnd.rar", buffer: rar(5_000) },
    ]);
    await waitAllReady(page, 3);
    // Pré-visualização: miniatura da imagem, nome e tamanho.
    await expect(page.getByTestId("outgoing-item").first().locator("img")).toBeVisible();
    await expect(page.getByTestId("outgoing-item").nth(1)).toContainText("contrato.pdf");
    await page.getByLabel("Legenda de contrato.pdf").fill("Segue o contrato");
    await page.getByLabel("Digitar mensagem de texto").fill("Obrigado!");
    await page.getByRole("button", { name: "Enviar mensagem" }).click();

    // Bandeja e caixa liberadas na hora.
    await expect(page.getByTestId("outgoing-item")).toHaveCount(0);
    await expect(page.getByLabel("Digitar mensagem de texto")).toHaveValue("");

    await expect.poll(() => allSends().length, { timeout: 60_000 }).toBe(4);
    const sends = allSends();
    // Ordem: os três arquivos (na ordem da bandeja) e só depois o texto.
    expect(sends.map((entry) => entry.path.split("/")[2])).toEqual(["sendMedia", "sendMedia", "sendMedia", "sendText"]);
    expect(sends[3].body.text).toBe("Obrigado!");

    const [photo, contract, archive] = mediaRequests();
    expect(photo.body).toMatchObject({ mediatype: "image", mimetype: "image/png", fileName: "foto.png" });
    expect(photo.body.caption).toBeUndefined();
    expect(photo.download).toMatchObject({ status: 200, bytes: PNG.length });
    expect(contract.body).toMatchObject({ mediatype: "document", mimetype: "application/pdf", fileName: "contrato.pdf", caption: "Segue o contrato" });
    expect(contract.download).toMatchObject({ status: 200, bytes: 20_000, head: "255044462d312e34" });
    expect(archive.body).toMatchObject({ mediatype: "document", mimetype: "application/vnd.rar", fileName: "pacote.rar" });
    expect(archive.download).toMatchObject({ status: 200, bytes: 5_000 });
    // A URL entregue à Evolution é assinada e de vida curta.
    expect(String(photo.body.media)).toMatch(/\/object\/sign\/whatsapp-media\/.+\?token=/);
    expect(String(photo.body.number)).toBe("5582988887702");

    await expect(page.getByTestId("message-sending")).toHaveCount(0, { timeout: 30_000 });
    expect(attachmentCount()).toBe(3);
    expect(Number(queryLocalSql(`select count(*) from public.messages where conversation_id = '${conversation}' and direction = 'outgoing' and status = 'sent' and external_message_id like 'FAKE-EVO-%';`))).toBe(4);
    // Auditoria do envio de arquivo, sem o nome.
    expect(Number(queryLocalSql("select count(*) from public.audit_events where action = 'message.file_sent';"))).toBe(3);
    expect(Number(queryLocalSql("select count(*) from public.audit_events where action = 'message.file_sent' and metadata::text like '%contrato%';"))).toBe(0);

    // Na conversa (mesmo componente das mídias recebidas): a miniatura carrega pela rota autorizada e o PDF aparece.
    await page.reload();
    const history = page.getByLabel("Histórico de mensagens");
    await expect(history.getByText("Segue o contrato")).toBeVisible();
    const image = history.locator('img[alt="foto.png"]');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await expect(history.getByText(/contrato\.pdf/).first()).toBeVisible();
  });

  test("imagem 'como documento' vai sem compressão (mediatype document)", async ({ page }) => {
    await open(page);
    await page.getByTestId("file-input").setInputFiles([{ name: "planta.png", mimeType: "image/png", buffer: PNG }]);
    await waitAllReady(page, 1);
    await page.getByLabel("Enviar como documento (sem compressão)").check();
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => mediaRequests().length, { timeout: 30_000 }).toBe(1);
    expect(mediaRequests()[0].body).toMatchObject({ mediatype: "document", mimetype: "image/png", fileName: "planta.png" });
  });

  test("vídeo curto vai como vídeo e aparece na conversa com o mesmo limite de tamanho da foto", async ({ page }) => {
    await open(page);
    await page.getByTestId("file-input").setInputFiles([{ name: "visita.mp4", mimeType: "video/mp4", buffer: mp4(3_000) }]);
    await waitAllReady(page, 1);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => mediaRequests().length, { timeout: 30_000 }).toBe(1);
    expect(mediaRequests()[0].body).toMatchObject({ mediatype: "video", mimetype: "video/mp4", fileName: "visita.mp4" });
    await expect(page.getByLabel("Histórico de mensagens").getByTestId("message-sending")).toHaveCount(0, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByLabel("Histórico de mensagens").getByTestId("video-thumb")).toHaveCount(1);
  });

  test("limites: 24 MB envia, 26 MB é recusado com mensagem clara, mais de 10 arquivos, e arquivos vazios", async ({ page }) => {
    await open(page);
    await page.getByTestId("file-input").setInputFiles([{ name: "grande.pdf", mimeType: "application/pdf", buffer: pdf(26 * MB) }]);
    await expect(page.getByTestId("outgoing-notice")).toContainText("25 MB");
    await expect(page.getByTestId("outgoing-item")).toHaveCount(0);

    await page.getByTestId("file-input").setInputFiles([{ name: "vazio.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) }]);
    await expect(page.getByTestId("outgoing-notice")).toContainText("vazio");

    await page.getByTestId("file-input").setInputFiles([{ name: "quase.pdf", mimeType: "application/pdf", buffer: pdf(24 * MB) }]);
    await waitAllReady(page, 1);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => mediaRequests().length, { timeout: 90_000 }).toBe(1);
    await expect.poll(() => mediaRequests()[0]?.download?.bytes, { timeout: 60_000 }).toBe(24 * MB);
    expect(mediaRequests()[0].download).toMatchObject({ status: 200 });

    const many = Array.from({ length: 11 }, (_, index) => ({ name: `doc${index + 1}.pdf`, mimeType: "application/pdf", buffer: pdf(2_000) }));
    await page.getByTestId("file-input").setInputFiles(many);
    await expect(page.getByTestId("outgoing-notice")).toContainText("Máximo de 10");
    await expect(page.getByTestId("outgoing-item")).toHaveCount(10);
  });

  test("BLOQUEIA executáveis e scripts, inclusive disfarçados (extensão de foto com conteúdo de programa)", async ({ page }) => {
    await open(page);
    await page.getByTestId("file-input").setInputFiles([
      { name: "setup.exe", mimeType: "application/x-msdownload", buffer: exe(2_000) },
      { name: "rodar.bat", mimeType: "text/plain", buffer: Buffer.from("@echo off\r\n") },
      { name: "foto.jpg", mimeType: "image/jpeg", buffer: exe(2_000) },
      { name: "script.sh", mimeType: "text/x-sh", buffer: Buffer.from("#!/bin/sh\necho oi\n") },
    ]);
    await expect(page.getByTestId("outgoing-item")).toHaveCount(0);
    const notice = page.getByTestId("outgoing-notice");
    await expect(notice).toContainText("setup.exe");
    await expect(notice).toContainText("rodar.bat");
    await expect(notice).toContainText("foto.jpg");
    await expect(notice).toContainText("script.sh");
    await expect(notice).toContainText("programa ou script");
    expect(mediaRequests()).toHaveLength(0);
  });

  test("arrastar e soltar destaca a conversa, anexa, e soltar fora da área não deixa o navegador abrir o arquivo", async ({ page }) => {
    await open(page);
    // Arrasta sobre a conversa: a área é destacada.
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["%PDF-1.4 conteúdo"], "arrastado.pdf", { type: "application/pdf" }));
      (window as unknown as { __dt: DataTransfer }).__dt = transfer;
      const column = document.querySelector('[data-testid="conversation-column"]') as HTMLElement;
      column.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId("drop-overlay")).toBeVisible();
    // Solta dentro da conversa: anexa. Solta FORA (corpo da página): o padrão do navegador (abrir o arquivo) é cancelado.
    const dropped = await page.evaluate(() => {
      const transfer = (window as unknown as { __dt: DataTransfer }).__dt;
      const column = document.querySelector('[data-testid="conversation-column"]') as HTMLElement;
      column.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      const other = new DataTransfer();
      other.items.add(new File(["x"], "fora.pdf", { type: "application/pdf" }));
      const notPrevented = document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: other, bubbles: true, cancelable: true }));
      return { outsideDefaultPrevented: !notPrevented };
    });
    expect(dropped.outsideDefaultPrevented).toBe(true);
    await expect(page.getByTestId("drop-overlay")).toHaveCount(0);
    await expect(page.getByTestId("outgoing-item")).toHaveCount(1);
    await expect(page.getByTestId("outgoing-item")).toContainText("arrastado.pdf");
  });

  test("colar com Ctrl+V: imagem vira anexo e o texto colado continua texto", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const box = document.querySelector("textarea") as HTMLTextAreaElement;
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "image.png", { type: "image/png" }));
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId("outgoing-item")).toHaveCount(1);
    await expect(page.getByTestId("outgoing-item")).toContainText("image.png");
    expect(await page.getByLabel("Digitar mensagem de texto").inputValue()).toBe("");
  });

  test("cancelar o upload em andamento remove o arquivo e nada é enviado", async ({ page }) => {
    await open(page);
    await page.route("**/storage/v1/object/upload/sign/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    await page.getByTestId("file-input").setInputFiles([{ name: "lento.pdf", mimeType: "application/pdf", buffer: pdf(300_000) }]);
    await expect(page.getByTestId("outgoing-item")).toHaveCount(1);
    await expect(page.getByTestId("outgoing-item")).toContainText("enviando");
    await expect(page.getByRole("progressbar")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar o envio de lento.pdf" }).click();
    await expect(page.getByTestId("outgoing-item")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enviar mensagem" })).toBeDisabled();
    await page.waitForTimeout(4_000);
    expect(mediaRequests()).toHaveLength(0);
  });

  test("falha da Evolution: bolha 'não enviada' com o motivo e 'Tentar de novo' reenvia como nova mensagem", async ({ page }) => {
    await open(page);
    fake.behavior.fail = ({ body }) => (body.fileName === "falha.pdf" ? 500 : null);
    await page.getByTestId("file-input").setInputFiles([{ name: "falha.pdf", mimeType: "application/pdf", buffer: pdf(3_000) }]);
    await waitAllReady(page, 1);
    await page.getByRole("button", { name: "Enviar mensagem" }).click();

    const history = page.getByLabel("Histórico de mensagens");
    await expect(history.getByTestId("message-failed")).toHaveCount(1, { timeout: 30_000 });
    await expect(history.getByTestId("message-failed-detail")).toContainText(/WhatsApp/);
    await expect(history.getByTestId("message-retry")).toBeVisible();
    // O motivo nunca mostra a URL assinada nem o nome interno do arquivo no Storage.
    const detail = (await history.getByTestId("message-failed-detail").innerText()) + (await history.innerText());
    expect(detail).not.toMatch(/token=|\/object\/sign|storage\/v1/);
    expect(mediaRequests()).toHaveLength(1);
    await page.waitForTimeout(2_000);
    expect(mediaRequests()).toHaveLength(1); // nada reenviado sozinho

    fake.behavior.fail = undefined;
    await history.getByTestId("message-retry").click();
    await expect.poll(() => mediaRequests().length, { timeout: 30_000 }).toBe(2);
    expect(mediaRequests()[1].body).toMatchObject({ fileName: "falha.pdf", mediatype: "document" });
    await expect.poll(() => mediaRequests()[1]?.download?.bytes, { timeout: 30_000 }).toBe(3_000);
    await expect(history.getByTestId("message-retry")).toHaveCount(0, { timeout: 30_000 });
    expect(Number(queryLocalSql(`select count(*) from public.messages m join public.attachments a on a.message_id = m.id where m.conversation_id = '${conversation}' and a.original_file_name = 'falha.pdf' and m.status = 'sent';`))).toBe(1);
  });

  test("segurança: a URL de upload só vale para o próprio caminho e o bucket não é público", async ({ page, request }) => {
    await open(page);
    const putPromise = page.waitForRequest((candidate) => candidate.method() === "PUT" && candidate.url().includes("/object/upload/sign/"));
    await page.getByTestId("file-input").setInputFiles([{ name: "seguro.pdf", mimeType: "application/pdf", buffer: pdf(4_000) }]);
    const signedUrl = (await putPromise).url();
    await waitAllReady(page, 1);

    // O mesmo token em OUTRO caminho (outra conversa/arquivo) é recusado pelo Storage.
    const forged = signedUrl.replace(/\/out\/[0-9a-f-]{36}/, "/out/00000000-0000-4000-8000-000000000000");
    expect(forged).not.toBe(signedUrl);
    const forgedResponse = await request.put(forged, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY ?? "", "x-upsert": "false" },
      multipart: { cacheControl: "3600", "": { name: "x.pdf", mimeType: "application/pdf", buffer: pdf(100) } },
    });
    expect(forgedResponse.ok()).toBe(false);

    // O bucket é privado: leitura pública e anônima do arquivo enviado falha.
    const objectPath = new URL(signedUrl).pathname.split("/object/upload/sign/whatsapp-media/")[1];
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publicRead = await request.get(`${base}/storage/v1/object/public/whatsapp-media/${objectPath}`);
    expect(publicRead.ok()).toBe(false);
    const anonRead = await request.get(`${base}/storage/v1/object/whatsapp-media/${objectPath}`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_CLIENT_KEY ?? "" } });
    expect(anonRead.ok()).toBe(false);
    // O caminho é do workspace e da conversa certos.
    const workspace = queryLocalSql(`select workspace_id from public.conversations where id = '${conversation}';`);
    expect(objectPath.startsWith(`${workspace}/${conversation}/out/`)).toBe(true);
  });

  test("grupo: sem envio de arquivos (o clipe fica desativado)", async ({ page, request }) => {
    queryLocalSql("update public.channel_connections set ingest_groups = true;");
    const groupId = await ingestText(request, {
      jid: "120363000000000001@g.us",
      text: "Mensagem no grupo",
      participant: "5582988887799@s.whatsapp.net",
      pushName: "Membro",
      subject: "Grupo teste",
    });
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${groupId}`);
    await expect(page.getByTestId("attach-button")).toBeDisabled();
  });
});
