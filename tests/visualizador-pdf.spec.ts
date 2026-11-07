import { expect, test } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Regressão do Segurança 2: X-Frame-Options DENY bloqueava até o quadro do próprio site e o visualizador de PDF
// mostrava "bloqueado" (ERR_BLOCKED_BY_RESPONSE). Com SAMEORIGIN o PDF carrega no quadro; terceiros continuam fora.

const FAKE_PORT = 4097;
const JID = "5582988889102@s.whatsapp.net";
let fake: FakeEvolution;
let conversation = "";

const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R/Size 4>>\n%%EOF\n",
);

test.describe.configure({ mode: "serial" });

test.describe("Visualizador de PDF", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    conversation = await ingestText(request, { jid: JID, text: "Oi", pushName: "Cliente PDF" });
  });
  test.afterAll(async () => {
    await fake?.close();
  });

  test("o PDF carrega no quadro do visualizador e a rota de anexos permite só o próprio site", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${conversation}`);
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    await page.getByTestId("file-input").setInputFiles([{ name: "contrato.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await expect(page.getByTestId("outgoing-item").filter({ hasText: "pronto" })).toHaveCount(1, { timeout: 60_000 });
    await page.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect.poll(() => Number(queryLocalSql(`select count(*) from public.attachments a join public.messages m on m.id = a.message_id where m.conversation_id = '${conversation}' and a.mime_type = 'application/pdf';`))).toBe(1);

    const id = queryLocalSql(`select a.id from public.attachments a join public.messages m on m.id = a.message_id where m.conversation_id = '${conversation}' and a.mime_type = 'application/pdf' limit 1;`).trim();
    const response = await page.request.get(`/api/attachments/${id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers()["content-security-policy"]).toBeUndefined();

    const framed = page.waitForResponse((r) => r.url().includes(`/api/attachments/${id}`) && r.request().frame() !== page.mainFrame(), { timeout: 30_000 });
    const failed: string[] = [];
    page.on("requestfailed", (request) => {
      if (request.url().includes(`/api/attachments/${id}`)) failed.push(request.failure()?.errorText ?? "falhou");
    });
    await page.reload();
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Visualizar aqui" }).first().click();
    await expect(page.locator('iframe[title^="Visualização de"]')).toBeVisible();
    // A resposta do quadro (não a da página principal) chega com 200, PDF e SAMEORIGIN, e nada falhou (ERR_BLOCKED_BY_RESPONSE).
    const inFrame = await framed;
    expect(inFrame.status()).toBe(200);
    expect(inFrame.headers()["x-frame-options"]).toBe("SAMEORIGIN");
    await page.waitForTimeout(1500);
    expect(failed).toEqual([]);
  });
});
