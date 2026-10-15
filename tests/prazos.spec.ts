import { expect, test, type Page } from "@playwright/test";
import { loginAsDemoAttendant, loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText, postWebhook, textPayload } from "./helpers/webhook";

const hoursAgo = (hours: number) => Math.floor(Date.now() / 1000) - Math.round(hours * 3600);
const OWN_NUMBER = "5582999905599";

let late = ""; // cliente escreveu há 2 h, ninguém respondeu (equipe devendo)
let waiting = ""; // nós escrevemos por último, há 20 h (aguardando cliente)
let group = "";
let self = "";

async function open(page: Page, id: string) {
  await page.goto(`/conversas/${id}`);
  await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
}
const card = (page: Page, id: string) => page.locator(`#conv-card-${id}`);

test.describe.configure({ mode: "serial" });

test.describe("Prazos: pausa por conversa, limites configuráveis, grupos e conversa consigo mesmo", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await resetAndLoadDemoMode();
    queryLocalSql(`update public.channel_connections set ingest_groups = true, external_phone_normalized = '+${OWN_NUMBER}';`);
    late = await ingestText(request, { jid: "5582988887801@s.whatsapp.net", text: "Preciso de ajuda", pushName: "Cliente Atrasado", timestamp: hoursAgo(2) });
    // Conversa em que a equipe escreveu por último há 20 h.
    waiting = await ingestText(request, { jid: "5582988887802@s.whatsapp.net", text: "Segue a proposta", fromMe: true, timestamp: hoursAgo(20) });
    group = await ingestText(request, { jid: "120363000000000777@g.us", text: "Bom dia, grupo", participant: "5582988887803@s.whatsapp.net", pushName: "Membro", subject: "Grupo da obra", timestamp: hoursAgo(1) });
    self = await ingestText(request, { jid: `${OWN_NUMBER}@s.whatsapp.net`, text: "lembrete para mim", fromMe: true, timestamp: hoursAgo(3) });
  });

  test("Prioridades: a conversa de ~20 h agora aparece em Follow-up (limite padrão 6 h), por nível, sem grupo nem conversa consigo mesmo", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/prioridades");
    const followup = page.getByRole("region", { name: /Aguardando Cliente/ });
    await expect(followup.getByTestId("followup-level-1")).toBeVisible();
    await expect(followup.getByTestId("followup-level-1")).toContainText("mais de 6 h");
    await expect(followup.getByRole("link", { name: /Contato 5582988887802|5582988887802/ }).first()).toBeVisible();
    const team = page.getByRole("region", { name: /Equipe Devendo Resposta/ });
    await expect(team).toContainText("Cliente Atrasado");
    await expect(page.getByText("Grupo da obra")).toHaveCount(0);
    await expect(page.getByText("lembrete para mim")).toHaveCount(0);
    // Nenhum chip de prazo em grupo nem na conversa consigo mesmo, nem na lista.
    await page.goto(`/conversas/${late}`);
    await expect(card(page, group).getByTestId("sla-badge")).toHaveCount(0);
    await expect(card(page, group).getByTestId("group-mark")).toBeVisible();
    await expect(card(page, self).getByTestId("sla-badge")).toHaveCount(0);
    await expect(card(page, late).getByTestId("sla-badge")).toBeVisible();
    await expect(card(page, waiting).getByTestId("sla-badge")).toBeVisible();
  });

  test("grupo e conversa consigo mesmo: sem tarja de prazo e sem controle de prazo no cabeçalho", async ({ page }) => {
    await loginAsDemoOwner(page);
    await open(page, group);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-badge")).toHaveCount(0);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-control")).toHaveCount(0);
    await expect(page.getByTestId("conversation-header").getByTestId("group-mark")).toBeVisible();
    await open(page, self);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-badge")).toHaveCount(0);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-control")).toHaveCount(0);
  });

  test("pausar até o cliente falar de novo: some tarja, sai de Prioridades; mensagem do cliente depois da pausa retoma sozinho", async ({ page, request }) => {
    await loginAsDemoOwner(page);
    await open(page, late);
    const header = page.getByTestId("conversation-header");
    await expect(header.getByTestId("sla-badge")).toBeVisible();
    await header.getByTestId("sla-control").click();
    await page.getByTestId("sla-option-paused").click();
    await expect(header.getByTestId("sla-control")).toHaveAttribute("data-sla-mode", "paused");
    await expect(header.getByTestId("sla-badge")).toHaveCount(0);
    await expect(header.getByTestId("sla-control")).toContainText("Prazo pausado");
    // A conversa continua na lista, só sem a tarja.
    await expect(card(page, late)).toBeVisible();
    await expect(card(page, late).getByTestId("sla-badge")).toHaveCount(0);

    await page.goto("/prioridades");
    await expect(page.getByRole("region", { name: /Equipe Devendo Resposta/ })).not.toContainText("Cliente Atrasado");
    expect(Number(queryLocalSql("select count(*) from public.audit_events where action = 'sla.conversation_paused';"))).toBe(1);

    // O cliente escreve de novo: o prazo volta sozinho.
    const response = await postWebhook(request, textPayload({ jid: "5582988887801@s.whatsapp.net", text: "Voltei! Ainda preciso", pushName: "Cliente Atrasado" }));
    expect(response.ok()).toBe(true);
    await page.goto(`/conversas/${late}`);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-badge")).toBeVisible();
    await page.goto("/prioridades");
    await expect(page.getByRole("region", { name: /Equipe Devendo Resposta/ })).toContainText("Cliente Atrasado");
  });

  test("desativar o prazo (permanente): nova mensagem do cliente não traz a tarja de volta; reativar manualmente", async ({ page, request }) => {
    await loginAsDemoOwner(page);
    await open(page, late);
    const header = page.getByTestId("conversation-header");
    await header.getByTestId("sla-control").click();
    await page.getByTestId("sla-option-disabled").click();
    await expect(header.getByTestId("sla-control")).toHaveAttribute("data-sla-mode", "disabled");
    await expect(header.getByTestId("sla-badge")).toHaveCount(0);

    await postWebhook(request, textPayload({ jid: "5582988887801@s.whatsapp.net", text: "Mais uma mensagem", pushName: "Cliente Atrasado" }));
    await page.reload();
    await expect(page.getByTestId("conversation-header").getByTestId("sla-badge")).toHaveCount(0);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-control")).toContainText("Prazo desativado");

    await page.getByTestId("conversation-header").getByTestId("sla-control").click();
    await page.getByTestId("sla-option-active").click();
    await expect(page.getByTestId("conversation-header").getByTestId("sla-badge")).toBeVisible();
    await expect(page.getByTestId("conversation-header").getByTestId("sla-control")).toHaveAttribute("data-sla-mode", "active");
  });

  test("atendente com acesso também controla o prazo; só o dono altera os limites", async ({ page }) => {
    await loginAsDemoAttendant(page);
    await page.goto("/configuracoes/prazos");
    await expect(page).toHaveURL(/\/prioridades\?reason=owner_required$/);
    await open(page, late);
    const header = page.getByTestId("conversation-header");
    await header.getByTestId("sla-control").click();
    await page.getByTestId("sla-option-paused").click();
    await expect(header.getByTestId("sla-control")).toHaveAttribute("data-sla-mode", "paused");
    await header.getByTestId("sla-control").click();
    await page.getByTestId("sla-option-active").click();
    await expect(header.getByTestId("sla-control")).toHaveAttribute("data-sla-mode", "active");
  });

  test("Configurações > Prazos: o dono altera os limites e o painel e o texto vazio seguem o novo limite", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/configuracoes");
    await page.getByRole("link", { name: /Prazos/ }).click();
    await expect(page.getByRole("heading", { name: "Prazos" })).toBeVisible();
    await expect(page.getByTestId("followup-preview")).toContainText("6 h");
    await expect(page.getByLabel("1º nível (amarelo)", { exact: true })).toHaveValue("6");

    // valor inválido (nível menor que o anterior): recusado com mensagem clara
    await page.getByLabel("2º nível (laranja)", { exact: true }).fill("2");
    await page.getByLabel("Unidade de 2º nível (laranja)").selectOption("h"); // 2 h < 6 h do 1º nível
    await page.getByRole("button", { name: "Salvar prazos" }).click();
    await expect(page.getByTestId("sla-settings-error")).toContainText("cada nível precisa ser maior");
    expect(Number(queryLocalSql("select count(*) from public.workspace_sla_settings;"))).toBe(0);

    // follow-up: 1º nível passa para 1 dia (24 h); 2º, 2 dias; 3º, 4 dias
    await page.getByLabel("2º nível (laranja)", { exact: true }).fill("2");
    await page.getByLabel("Unidade de 2º nível (laranja)").selectOption("d");
    await page.getByLabel("3º nível (vermelho)", { exact: true }).fill("4");
    await page.getByLabel("Unidade de 3º nível (vermelho)").selectOption("d");
    await page.getByLabel("1º nível (amarelo)", { exact: true }).fill("1");
    await page.getByLabel("Unidade de 1º nível (amarelo)").selectOption("d");
    await page.getByRole("button", { name: "Salvar prazos" }).click();
    await expect(page.getByTestId("sla-settings-saved")).toBeVisible();
    expect(queryLocalSql("select followup_level1_minutes || '/' || followup_level2_minutes || '/' || followup_level3_minutes from public.workspace_sla_settings;")).toBe("1440/2880/5760");
    expect(Number(queryLocalSql("select count(*) from public.audit_events where action = 'sla.limits_changed';"))).toBe(1);

    // a conversa de 20 h deixa de aparecer; o texto vazio acompanha o limite configurado
    await page.goto("/prioridades");
    const followup = page.getByRole("region", { name: /Aguardando Cliente/ });
    await expect(followup).not.toContainText("5582988887802"); // a de 20 h saiu: o 1º nível agora é 24 h
    await expect(followup.getByTestId("followup-level-1")).toContainText("mais de 24 h");
    // Sem nenhuma conversa em espera, o texto vazio acompanha o limite configurado.
    queryLocalSql("update public.conversations set operational_status = 'archived', archived_at = now() where operational_status = 'active';");
    await page.reload();
    await expect(page.getByRole("region", { name: /Aguardando Cliente/ })).toContainText("Nenhuma conversa parada há mais de 24 h");
    queryLocalSql("update public.conversations set operational_status = 'active', archived_at = null where operational_status = 'archived';");

    // "Cliente aguardando" também usa os limites novos: com verde até 3 h, a conversa de 2 h fica verde (no padrão era vermelha)
    await page.goto("/configuracoes/prazos");
    // verde até 3 h, amarelo 4 h, laranja 5 h, vermelho 6 h
    for (const [label, hours] of [["Verde até", "3"], ["Amarelo até", "4"], ["Laranja até", "5"], ["Vermelho até", "6"]] as const) {
      await page.getByLabel(`Unidade de ${label}`).selectOption("h");
      await page.getByLabel(label, { exact: true }).fill(hours);
    }
    await page.getByRole("button", { name: "Salvar prazos" }).click();
    await expect(page.getByTestId("sla-settings-saved")).toBeVisible();
    await page.goto(`/conversas/${late}`);
    await expect(card(page, late).getByTestId("sla-badge")).toHaveAttribute("data-sla-tone", "green");

    // restaurar padrões
    await page.goto("/configuracoes/prazos");
    await page.getByRole("button", { name: "Restaurar padrões" }).click();
    await page.getByRole("button", { name: "Salvar prazos" }).click();
    await expect(page.getByTestId("sla-settings-saved")).toBeVisible();
    await page.goto("/prioridades");
    await expect(page.getByRole("region", { name: /Aguardando Cliente/ }).getByTestId("followup-level-1")).toBeVisible();
  });

  test("Auditoria: eventos de prazo têm rótulo próprio (categoria Prazos), não 'Outros'", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/configuracoes/auditoria");
    await expect(page.getByText("Prazo da conversa pausado até o cliente falar de novo").first()).toBeVisible();
    await expect(page.getByText("Prazo da conversa desativado").first()).toBeVisible();
    await expect(page.getByText("Limites de prazo alterados").first()).toBeVisible();
    await expect(page.getByText("Outros", { exact: true })).toHaveCount(0);
  });
});
