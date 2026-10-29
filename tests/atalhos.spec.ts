import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Atalhos: Esc em camadas, rascunho preservado, Alt+setas, ajuda só pelo botão (sem a tecla "?") e atalhos do navegador intactos.

const FAKE_PORT = 3099;
const JID_A = "5582988889001@s.whatsapp.net";
const JID_B = "5582988889002@s.whatsapp.net";

let fake: FakeEvolution;
let convA = "";
let convB = "";

const composer = (page: Page) => page.getByLabel("Digitar mensagem de texto");
const history = (page: Page) => page.getByLabel("Histórico de mensagens");

async function open(page: Page, id = convA) {
  await page.goto(`/conversas/${id}`);
  await expect(composer(page)).toBeVisible();
  await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
}

async function openMenu(page: Page, text: string) {
  const row = history(page).locator("[data-message-id]").filter({ hasText: text }).first();
  await row.hover();
  await row.getByTestId("message-menu-button").click();
  await expect(page.getByTestId("message-menu")).toBeVisible();
  return row;
}

test.describe.configure({ mode: "serial" });

test.describe("Atalhos", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    convA = await ingestText(request, { jid: JID_A, text: "Olá, primeira conversa", pushName: "Cliente Atalho A" });
    convB = await ingestText(request, { jid: JID_B, text: "Olá, segunda conversa", pushName: "Cliente Atalho B" });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test.beforeEach(async ({ page }) => {
    fake.reset();
    await loginAsDemoOwner(page);
  });

  // O servidor de desenvolvimento compila cada rota na primeira visita (e recompila depois de cada alteração de código): visita
  // as rotas antes, para o tempo de compilação não cair dentro de um teste.
  test("aquecimento das rotas", async ({ page }) => {
    test.setTimeout(240_000);
    await open(page);
    await page.goto("/conversas");
    await expect(page.locator('[id^="conv-card-"]').first()).toBeVisible({ timeout: 120_000 });
  });

  test("Esc dentro da conversa fecha a conversa e devolve o foco ao item da lista", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Escape");
    // A primeira ida a /conversas depois de uma alteração de código compila a rota (o servidor de desenvolvimento é lento aí).
    await expect(page).toHaveURL(/\/conversas$/, { timeout: 40_000 });
    await expect(page.locator(`#conv-card-${convA}`)).toBeFocused();
  });

  test("Esc fecha UMA camada por vez: menu da mensagem, depois a busca, e só então a conversa", async ({ page }) => {
    await open(page);
    // Busca aberta + menu da mensagem aberto: Esc fecha o menu primeiro.
    await page.getByTestId("conversation-search-toggle").click();
    await expect(page.getByTestId("conversation-search")).toBeVisible();
    await openMenu(page, "primeira conversa");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("message-menu")).toHaveCount(0);
    await expect(page.getByTestId("conversation-search")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
    // Segundo Esc: a busca.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("conversation-search")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
    // Terceiro Esc: a conversa.
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/conversas$/);
  });

  test("Esc: seletor de emoji fecha antes da conversa", async ({ page }) => {
    await open(page);
    await openMenu(page, "primeira conversa");
    await page.getByTestId("action-react").click();
    await expect(page.getByTestId("emoji-picker")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("emoji-picker")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
  });

  test("Esc: cartão de citação, depois a conversa — e o rascunho continua na caixa", async ({ page }) => {
    await open(page);
    await composer(page).fill("rascunho que não pode sumir");
    await openMenu(page, "primeira conversa");
    await page.getByTestId("action-reply").click();
    await expect(page.getByTestId("reply-card")).toBeVisible();
    await composer(page).press("Escape");
    await expect(page.getByTestId("reply-card")).toHaveCount(0);
    await expect(composer(page)).toHaveValue("rascunho que não pode sumir");
    await composer(page).press("Escape");
    await expect(page).toHaveURL(/\/conversas$/);
    // Reabrir: o rascunho volta.
    await open(page);
    await expect(composer(page)).toHaveValue("rascunho que não pode sumir");
    // Ir para outra conversa e voltar também preserva (e o rascunho é por conversa).
    await open(page, convB);
    await expect(composer(page)).toHaveValue("");
    await open(page, convA);
    await expect(composer(page)).toHaveValue("rascunho que não pode sumir");
    // Recarregar a página também preserva (sessionStorage).
    await page.reload();
    await expect(composer(page)).toHaveValue("rascunho que não pode sumir");
    // Enviar limpa o rascunho.
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("");
    await open(page);
    await expect(composer(page)).toHaveValue("");
  });

  test("Esc: lista '/' de respostas rápidas fecha mantendo o texto; depois a conversa", async ({ page }) => {
    await open(page);
    await composer(page).fill("oi /");
    await expect(page.getByTestId("slash-menu")).toBeVisible();
    await composer(page).press("Escape");
    await expect(page.getByTestId("slash-menu")).toHaveCount(0);
    await expect(composer(page)).toHaveValue("oi /");
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
    await composer(page).fill("");
    await composer(page).press("Escape");
    await expect(page).toHaveURL(/\/conversas$/);
  });

  test("Esc cancela a edição e devolve o rascunho que existia antes", async ({ page }) => {
    await open(page);
    await composer(page).fill("minha mensagem editável");
    await composer(page).press("Enter");
    await expect(history(page).getByText("minha mensagem editável")).toBeVisible();
    await expect(history(page).getByTestId("message-sending")).toHaveCount(0, { timeout: 20_000 });
    await composer(page).fill("outro rascunho");
    await openMenu(page, "minha mensagem editável");
    await page.getByTestId("action-edit").click();
    await expect(page.getByTestId("edit-banner")).toBeVisible();
    await expect(composer(page)).toHaveValue("minha mensagem editável");
    await composer(page).press("Escape");
    await expect(page.getByTestId("edit-banner")).toHaveCount(0);
    await expect(composer(page)).toHaveValue("outro rascunho");
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
    await composer(page).fill("");
  });

  test("Esc cancela a gravação de áudio sem enviar e sem fechar a conversa", async ({ page }) => {
    await page.context().grantPermissions(["microphone"]);
    await open(page);
    await page.getByTestId("voice-start").click();
    await expect(page.getByTestId("voice-timer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("voice-bar")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
    expect(fake.requests.filter((request) => request.path.includes("sendWhatsAppAudio"))).toHaveLength(0);
  });

  test("Esc com o modal de encaminhar aberto fecha só o modal", async ({ page }) => {
    await open(page);
    await openMenu(page, "primeira conversa");
    await page.getByTestId("action-forward").click();
    await expect(page.getByTestId("forward-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("forward-dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
  });

  test("Esc não descarta a fila de envio: a mensagem em andamento sai mesmo fechando a conversa", async ({ page }) => {
    fake.behavior.delay = ({ path }) => (path.includes("/message/sendText/") ? 1500 : 0);
    await open(page);
    await composer(page).fill("mensagem na fila antes do Esc");
    await composer(page).press("Enter");
    await composer(page).press("Escape");
    await expect(page).toHaveURL(/\/conversas$/);
    await expect.poll(() => fake.requests.filter((request) => request.path.includes("/message/sendText/")).length, { timeout: 20_000 }).toBe(1);
    await open(page);
    await expect(history(page).getByText("mensagem na fila antes do Esc")).toBeVisible();
    await expect(history(page).getByTestId("message-sending")).toHaveCount(0, { timeout: 20_000 });
  });

  test("Alt+seta para baixo/cima navega entre as conversas da lista", async ({ page }) => {
    await open(page, convB);
    const listIds = () => page.locator('[id^="conv-card-"]').evaluateAll((nodes) => nodes.map((node) => node.id.replace("conv-card-", "")));
    await expect.poll(async () => (await listIds()).includes(convB)).toBe(true);
    // A lista só ouve as teclas depois de hidratar (ela marca o html quando o tempo real conecta).
    await expect(page.locator('html[data-realtime-inbox="ready"]')).toBeAttached({ timeout: 30_000 });
    const before = await listIds();
    const index = before.indexOf(convB);
    // A tecla se perde se vier antes de a lista ligar o atalho: repete até navegar (só repete se nada aconteceu).
    await expect(async () => {
      await page.keyboard.press("Alt+ArrowDown");
      await expect(page).not.toHaveURL(new RegExp(`/conversas/${convB}$`), { timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    const afterDown = new URL(page.url()).pathname.split("/").pop() as string;
    // Foi para uma vizinha da lista (a ordem pode mudar um pouco com o tempo real), e Alt+seta para cima volta.
    expect(before).toContain(afterDown);
    expect(Math.abs(before.indexOf(afterDown) - index)).toBeLessThanOrEqual(2);
    await page.keyboard.press("Alt+ArrowUp");
    await expect(page).toHaveURL(new RegExp(`/conversas/${convB}$`));
  });

  test("a tecla '?' NÃO abre nada; a ajuda abre só pelo botão do topo; Ctrl+K/F/R seguem do navegador", async ({ page }) => {
    await open(page);
    await composer(page).fill("");
    await composer(page).press("?");
    await expect(composer(page)).toHaveValue("?");
    await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
    await composer(page).fill("");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("?");
    await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
    await page.getByTestId("shortcuts-button").click();
    await expect(page.getByTestId("shortcuts-help")).toBeVisible();
    await expect(page.getByTestId("shortcuts-help")).toContainText("Esc");
    await expect(page.getByTestId("shortcuts-help")).toContainText("Alt + ↑ / ↓");
    // A ajuda não lista mais o atalho "?".
    await expect(page.getByTestId("shortcuts-help").locator("kbd", { hasText: /^[?]$/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcuts-help")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/conversas/${convA}$`));
    // Nada de sequestrar atalhos do navegador.
    const prevented = await page.evaluate(() =>
      ["k", "f", "r"].map((key) => {
        const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
    expect(prevented).toEqual([false, false, false]);
  });
});
