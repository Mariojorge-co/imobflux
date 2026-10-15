import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  loginAsDemoAttendant,
  loginAsDemoOwner,
  queryLocalSql,
  resetAndLoadDemoMode,
} from "./helpers/local-test-state";

const CONVERSATION = "d3300003-0000-4000-8000-000000000001"; // "DEMO — Cliente Público"
const BODY = "Olá, {{nome}}! 😊\nVisita ao {{imovel}} no sábado.\n\n*Leve o RG* e _CPF_.";
const EXPECTED_INSERT = "Olá, DEMO! 😊\nVisita ao {{imovel}} no sábado.\n\n*Leve o RG* e _CPF_.";

async function newPage(browser: Browser, as: "owner" | "attendant"): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (as === "owner") await loginAsDemoOwner(page);
  else await loginAsDemoAttendant(page);
  return page;
}

function outgoingCount(): number {
  return Number(
    queryLocalSql(`select count(*) from public.messages where conversation_id = '${CONVERSATION}' and direction = 'outgoing';`),
  );
}

async function createReply(page: Page, title: string, body: string, category?: string) {
  await page.getByRole("button", { name: "Nova resposta" }).first().click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Título").fill(title);
  if (category) await dialog.getByLabel("Categoria").selectOption({ label: category });
  await dialog.getByLabel("Texto da mensagem").fill(body);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

test.describe("Respostas rápidas", () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await resetAndLoadDemoMode();
  });

  test("tela vazia: o dono adiciona os 5 exemplos e o texto não é gravado em nenhum dado por migration", async ({ browser }) => {
    const owner = await newPage(browser, "owner");
    expect(Number(queryLocalSql("select count(*) from public.quick_replies;"))).toBe(0);
    await owner.goto("/configuracoes/respostas-rapidas");
    await expect(owner.getByText("Nenhuma resposta rápida ainda")).toBeVisible();
    await owner.getByRole("button", { name: "Adicionar exemplos" }).click();
    for (const title of ["Boas-vindas", "Pedir documentos", "Confirmar visita", "Enviar localização", "Follow-up de proposta"]) {
      await expect(owner.getByTestId("manager-reply").filter({ hasText: title }).first()).toBeVisible();
    }
    await expect(owner.getByTestId("manager-reply")).toHaveCount(5);
    await owner.context().close();
  });

  test("atendente cria categoria e resposta; o texto fica exatamente como digitado", async ({ browser }) => {
    const attendant = await newPage(browser, "attendant");
    await expect(attendant.getByRole("link", { name: "Configurações" })).toHaveCount(0);
    await attendant.goto("/configuracoes/respostas-rapidas");
    await expect(attendant.getByRole("heading", { name: "Respostas rápidas" })).toBeVisible();

    await attendant.getByRole("button", { name: "Nova categoria" }).first().click();
    await attendant.locator("dialog[open]").getByLabel("Nome da categoria").fill("Visitas 🏠");
    await attendant.locator("dialog[open]").getByRole("button", { name: "Salvar" }).click();
    await expect(attendant.getByRole("region", { name: "Visitas 🏠" })).toBeVisible();

    await createReply(attendant, "Visita sábado", BODY, "Visitas 🏠");
    const card = attendant.getByTestId("manager-reply").filter({ hasText: "Visita sábado" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Criada por você")).toBeVisible();
    // A pré-visualização resolve as variáveis conhecidas e destaca a que sobra.
    await expect(card.getByTestId("unresolved-variable")).toHaveText("{{imovel}}");

    expect(queryLocalSql("select body from public.quick_replies where title = 'Visita sábado';")).toBe(BODY);
    await attendant.context().close();
  });

  test("permissões de edição: atendente não edita a do dono; o dono edita a do atendente", async ({ browser }) => {
    const owner = await newPage(browser, "owner");
    await owner.goto("/configuracoes/respostas-rapidas");
    // O dono vê o menu em todas, inclusive na criada pelo atendente.
    await expect(owner.getByRole("button", { name: "Ações de Visita sábado" })).toBeVisible();
    await expect(owner.getByRole("button", { name: "Ações de Boas-vindas" })).toBeVisible();

    const attendant = await newPage(browser, "attendant");
    await attendant.goto("/configuracoes/respostas-rapidas");
    await expect(attendant.getByRole("button", { name: "Ações de Visita sábado" })).toBeVisible();
    await expect(attendant.getByRole("button", { name: "Ações de Boas-vindas" })).toHaveCount(0);
    await expect(attendant.getByTestId("manager-reply").filter({ hasText: "Boas-vindas" })).toBeVisible();

    // O dono edita a resposta do atendente.
    await owner.getByRole("button", { name: "Ações de Visita sábado" }).click();
    await owner.getByRole("menuitem", { name: "Editar" }).click();
    const dialog = owner.locator("dialog[open]");
    await dialog.getByLabel("Título").fill("Visita no sábado");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(owner.getByTestId("manager-reply").filter({ hasText: "Visita no sábado" })).toBeVisible();
    expect(queryLocalSql("select count(*) from public.quick_replies where title = 'Visita no sábado';")).toBe("1");

    await owner.context().close();
    await attendant.context().close();
  });

  test("dono usa na conversa: INSERE sem enviar, variáveis resolvidas, e pede confirmação se sobrar {{campo}}", async ({ browser }) => {
    const owner = await newPage(browser, "owner");
    await owner.goto(`/conversas/${CONVERSATION}`);
    const box = owner.getByLabel("Digitar mensagem de texto");
    await expect(box).toBeVisible();
    const before = outgoingCount();

    // Já existe texto digitado: a resposta entra na posição do cursor.
    await box.fill("Antes  depois");
    await box.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 6));
    await owner.getByTestId("quick-replies-button").click();
    const panel = owner.getByTestId("quick-replies-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Tudo$/ })).toBeVisible();
    await panel.getByRole("button", { name: /Visita no sábado/ }).first().click();

    await expect(panel).toHaveCount(0);
    await expect(box).toHaveValue(`Antes ${EXPECTED_INSERT} depois`);
    await expect(box).toBeFocused();
    expect(outgoingCount()).toBe(before); // clicar NÃO envia

    // Ao enviar com {{imovel}} aberto, o sistema pergunta.
    await owner.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(owner.getByText("Há campos não preenchidos ({{imovel}}). Enviar mesmo assim?")).toBeVisible();
    await owner.getByRole("button", { name: "Cancelar" }).click();
    await expect(box).toHaveValue(`Antes ${EXPECTED_INSERT} depois`);
    expect(outgoingCount()).toBe(before);

    // Preenchendo o campo, envia direto (sem pergunta).
    await box.fill("Visita ao apto 302 no sábado.");
    await owner.getByRole("button", { name: "Enviar mensagem" }).click();
    await expect(owner.getByText("Há campos não preenchidos")).toHaveCount(0);
    await expect.poll(outgoingCount).toBe(before + 1);

    // O uso foi contado em segundo plano.
    await expect
      .poll(() => queryLocalSql("select use_count from public.quick_replies where title = 'Visita no sábado';"))
      .toBe("1");
    await owner.context().close();
  });

  test("'Enviar mesmo assim' envia com o campo em aberto", async ({ browser }) => {
    const owner = await newPage(browser, "owner");
    await owner.goto(`/conversas/${CONVERSATION}`);
    const box = owner.getByLabel("Digitar mensagem de texto");
    const before = outgoingCount();
    await box.fill("Segue o imóvel {{imovel}}");
    await owner.getByRole("button", { name: "Enviar mensagem" }).click();
    await owner.getByRole("button", { name: "Enviar mesmo assim" }).click();
    await expect.poll(outgoingCount).toBe(before + 1);
    await owner.context().close();
  });

  test("atalho '/': filtra, setas + Enter inserem; '1/2' não abre; Esc fecha", async ({ browser }) => {
    const owner = await newPage(browser, "owner");
    await owner.goto(`/conversas/${CONVERSATION}`);
    const box = owner.getByLabel("Digitar mensagem de texto");
    const before = outgoingCount();

    await box.click();
    await box.pressSequentially("apto 1/2");
    await expect(owner.getByTestId("slash-menu")).toHaveCount(0);

    await box.fill("");
    await box.pressSequentially("/docu");
    const menu = owner.getByTestId("slash-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option")).toHaveCount(1);
    await expect(menu.getByRole("option").first()).toContainText("Pedir documentos");

    await box.press("Escape");
    await expect(menu).toHaveCount(0);
    await box.fill("");
    await box.pressSequentially("/");
    await expect(menu).toBeVisible();
    await box.press("ArrowDown");
    await box.press("Enter");
    await expect(menu).toHaveCount(0);
    expect((await box.inputValue()).length).toBeGreaterThan(10);
    expect(await box.inputValue()).not.toContain("/");
    expect(outgoingCount()).toBe(before); // Enter na lista insere, não envia
    await owner.context().close();
  });

  test("caixa de mensagem: cresce até ~40% da tela, rola por dentro e expande até ~60%", async ({ browser }) => {
    const owner = await newPage(browser, "owner");
    await owner.setViewportSize({ width: 1440, height: 900 });
    await owner.goto(`/conversas/${CONVERSATION}`);
    const box = owner.getByLabel("Digitar mensagem de texto");
    await expect(box).toBeVisible(); // boundingBox não espera a página desenhar a caixa
    const height = async () => (await box.boundingBox())!.height;

    const small = await height();
    expect(small).toBeLessThan(60);
    await box.fill(Array.from({ length: 60 }, (_, index) => `linha ${index + 1}`).join("\n"));
    const grown = await height();
    expect(grown).toBeGreaterThan(200);
    expect(grown).toBeLessThanOrEqual(900 * 0.4 + 2);
    expect(await box.evaluate((element: HTMLTextAreaElement) => element.scrollHeight > element.clientHeight)).toBe(true);

    await owner.getByRole("button", { name: "Expandir a caixa de mensagem" }).click();
    await expect.poll(height).toBeGreaterThan(grown + 100);
    expect(await height()).toBeLessThanOrEqual(900 * 0.6 + 2);
    await owner.getByRole("button", { name: "Recolher a caixa de mensagem" }).click();
    await expect.poll(height).toBeLessThanOrEqual(900 * 0.4 + 2);
    await owner.context().close();
  });

  test("apagar categoria não apaga respostas: elas voltam para 'Sem categoria'", async ({ browser }) => {
    const owner = await newPage(browser, "owner");
    await owner.goto("/configuracoes/respostas-rapidas");
    const region = owner.getByRole("region", { name: "Visitas 🏠" });
    await expect(region.getByText("Visita no sábado")).toBeVisible();
    await region.getByRole("button", { name: /Ações de categoria Visitas/ }).click();
    await owner.getByRole("menuitem", { name: "Apagar" }).click();
    await expect(owner.getByText("As respostas desta categoria não serão apagadas")).toBeVisible();
    await owner.locator("dialog[open]").getByRole("button", { name: "Apagar" }).click();

    await expect(owner.getByRole("region", { name: "Visitas 🏠" })).toHaveCount(0);
    await expect(owner.getByRole("region", { name: "Sem categoria" }).getByText("Visita no sábado")).toBeVisible();
    expect(queryLocalSql("select count(*) from public.quick_replies where title = 'Visita no sábado' and category_id is null;")).toBe("1");
    await owner.context().close();
  });
});
