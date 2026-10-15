import { expect, test } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText, postWebhook, textPayload } from "./helpers/webhook";

const JID = "5582988887701@s.whatsapp.net";
const FAKE_PORT = 3099;
let CONVERSATION = "";

let fake: FakeEvolution;

function sentTexts(): string[] {
  return fake.requests.filter((request) => request.path.includes("/message/sendText/")).map((request) => String(request.body.text));
}

function dbCount(text: string, status?: string): number {
  const filter = status ? `and status = '${status}'` : "";
  return Number(
    queryLocalSql(
      `select count(*) from public.messages where conversation_id = '${CONVERSATION}' and direction = 'outgoing' and text_content = '${text}' ${filter};`,
    ),
  );
}

test.describe.configure({ mode: "serial" });

test.describe("Fila de envio: a caixa não trava e a ordem é preservada", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    CONVERSATION = await ingestText(request, { jid: JID, text: "Olá, quero ver o imóvel", pushName: "Cliente Fila" });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(() => fake.reset());

  test("3 mensagens seguidas e rápidas: caixa livre na hora, ordem correta, sem duplicar, eco do webhook não duplica", async ({ page, request }) => {
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${CONVERSATION}`);
    const box = page.getByLabel("Digitar mensagem de texto");
    const history = page.getByLabel("Histórico de mensagens");
    await expect(box).toBeVisible();

    // A primeira demora a ser aceita pela Evolution; as outras duas só podem sair DEPOIS dela.
    fake.behavior.delay = ({ body }) => (body.text === "FILA-1" ? 1500 : 0);

    for (const text of ["FILA-1", "FILA-2", "FILA-3"]) {
      await box.fill(text);
      await box.press("Enter");
      // A caixa é limpa e liberada na hora (não fica "processando").
      await expect(box).toHaveValue("");
      await expect(box).toBeEnabled();
    }

    // As três bolhas aparecem de imediato, na ordem, ainda "enviando…".
    for (const text of ["FILA-1", "FILA-2", "FILA-3"]) await expect(history.getByText(text, { exact: true })).toHaveCount(1);
    await expect(history.getByTestId("message-sending").first()).toBeVisible();

    await expect.poll(sentTexts, { timeout: 20_000 }).toEqual(["FILA-1", "FILA-2", "FILA-3"]);
    await expect(history.getByTestId("message-sending")).toHaveCount(0, { timeout: 20_000 });
    expect(fake.requests.every((entry) => entry.hasApiKey)).toBe(true);

    // Ordem na conversa e no banco; nenhuma duplicada.
    const order = await history.locator("p.whitespace-pre-wrap").allTextContents();
    expect(order.filter((text) => text.startsWith("FILA-"))).toEqual(["FILA-1", "FILA-2", "FILA-3"]);
    for (const text of ["FILA-1", "FILA-2", "FILA-3"]) {
      expect(dbCount(text, "sent")).toBe(1);
      expect(dbCount(text)).toBe(1);
    }

    // Eco do webhook (mesmo key.id): o banco reconhece pelo id externo e a tela não ganha bolha repetida.
    const external = queryLocalSql(
      `select external_message_id from public.messages where conversation_id = '${CONVERSATION}' and text_content = 'FILA-2' and direction = 'outgoing';`,
    );
    expect(external).toMatch(/^FAKE-EVO-/);
    const response = await postWebhook(request, textPayload({ jid: JID, text: "FILA-2", fromMe: true, id: external }));
    expect(response.ok()).toBe(true);
    expect(dbCount("FILA-2")).toBe(1);
    await page.reload();
    await expect(page.getByLabel("Histórico de mensagens").getByText("FILA-2", { exact: true })).toHaveCount(1);
  });

  test("falha no meio: só aquela fica 'não enviada' com motivo e 'Tentar de novo'; as outras seguem; nada reenvia sozinho", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto(`/conversas/${CONVERSATION}`);
    const box = page.getByLabel("Digitar mensagem de texto");
    const history = page.getByLabel("Histórico de mensagens");
    await expect(box).toBeVisible();

    fake.behavior.fail = ({ body }) => (body.text === "FALHA-B" ? 500 : null);

    for (const text of ["FALHA-A", "FALHA-B", "FALHA-C"]) {
      await box.fill(text);
      await box.press("Enter");
      await expect(box).toHaveValue("");
    }

    await expect.poll(sentTexts, { timeout: 20_000 }).toEqual(["FALHA-A", "FALHA-B", "FALHA-C"]);
    // Uma única bolha da mensagem que falhou (a provisória e a gravada não aparecem as duas).
    await expect(history.getByText("FALHA-B", { exact: true })).toHaveCount(1);
    await expect(history.getByTestId("message-failed")).toHaveCount(1);
    const bubbleB = history.locator("div").filter({ has: page.getByText("FALHA-B", { exact: true }) }).filter({ has: page.getByTestId("message-failed") }).last();
    await expect(bubbleB.getByTestId("message-failed-detail")).toContainText(/WhatsApp/);
    await expect(bubbleB.getByTestId("message-failed")).toHaveText("Não enviada");
    await expect(bubbleB.getByTestId("message-retry")).toBeVisible();
    expect(dbCount("FALHA-A", "sent")).toBe(1);
    expect(dbCount("FALHA-C", "sent")).toBe(1);
    expect(dbCount("FALHA-B", "failed")).toBe(1);

    // Nada é reenviado sozinho.
    await page.waitForTimeout(2500);
    expect(sentTexts()).toEqual(["FALHA-A", "FALHA-B", "FALHA-C"]);

    // "Tentar de novo": nova mensagem (nova chave), agora com a Evolution aceitando.
    fake.behavior.fail = undefined;
    await bubbleB.getByTestId("message-retry").click();
    await expect.poll(sentTexts, { timeout: 20_000 }).toEqual(["FALHA-A", "FALHA-B", "FALHA-C", "FALHA-B"]);
    await expect.poll(() => dbCount("FALHA-B", "sent")).toBe(1);
    await expect(history.getByTestId("message-retry")).toHaveCount(0);
    await expect(history.getByText("FALHA-B", { exact: true })).toHaveCount(1);
  });
});
