import { expect, test, type Page } from "@playwright/test";
import { startFakeEvolution, type FakeEvolution } from "./helpers/fake-evolution";
import { loginAsDemoAttendant, loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText, postWebhook, textPayload } from "./helpers/webhook";

const OWN = "5582999905599";
const FAKE_PORT = 3099;
const MEMBER_OK = "5582988887810@s.whatsapp.net";
const MEMBER_PROTECTED = "5582988887811@s.whatsapp.net";
const secondsAgo = (seconds: number) => Math.floor(Date.now() / 1000) - seconds;

let groupA = "";
let groupB = "";
let fake: FakeEvolution;

const card = (page: Page, id: string) => page.locator(`#conv-card-${id}`);
const messages = (page: Page) => page.getByLabel("Histórico de mensagens");

test.describe.configure({ mode: "serial" });

test.describe("Grupos (dono vê tudo; atendente só o liberado) e conversa consigo mesmo", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await resetAndLoadDemoMode();
    fake = await startFakeEvolution(FAKE_PORT);
    // Padrão de produção: leitura de grupos DESLIGADA. Uma mensagem de grupo com ela desligada não grava nada.
    queryLocalSql(`update public.channel_connections set ingest_groups = false, ingest_only_known_contacts = true, external_phone_normalized = '+${OWN}';`);
    const ignored = await postWebhook(request, textPayload({ jid: "120363000000000901@g.us", text: "NÃO PODE ENTRAR", participant: MEMBER_OK, pushName: "Membro", subject: "Grupo A" }));
    expect(ignored.ok()).toBe(true);
    expect(Number(queryLocalSql("select count(*) from public.conversations where conversation_type = 'group' and external_thread_id = '120363000000000901@g.us';"))).toBe(0);
    expect(Number(queryLocalSql("select count(*) from public.messages where text_content = 'NÃO PODE ENTRAR';"))).toBe(0);

    // Dono liga a leitura de grupos; agora entram, restritos ao dono.
    queryLocalSql("update public.channel_connections set ingest_groups = true;");
    groupA = await ingestText(request, { jid: "120363000000000901@g.us", text: "Mensagem ANTIGA do grupo A", participant: MEMBER_OK, pushName: "Membro Comum", subject: "Grupo A", timestamp: secondsAgo(7200) });
    groupB = await ingestText(request, { jid: "120363000000000902@g.us", text: "Mensagem do grupo B", participant: MEMBER_OK, pushName: "Membro Comum", subject: "Grupo B", timestamp: secondsAgo(600) });
  });

  test.afterAll(async () => {
    await fake?.close();
  });

  test("a leitura de grupos desligada não grava nada; ligada, os grupos nascem restritos ao dono", async () => {
    expect(queryLocalSql(`select visibility from public.conversations where id = '${groupA}';`)).toBe("owner_only");
    expect(queryLocalSql(`select visibility from public.conversations where id = '${groupB}';`)).toBe("owner_only");
  });

  test("dono vê TODOS os grupos em 'Tudo' (e no chip Grupos), com marca neutra e sem prazo", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/conversas");
    await expect(card(page, groupA)).toBeVisible();
    await expect(card(page, groupB)).toBeVisible();
    await expect(card(page, groupA).getByTestId("group-mark")).toBeVisible();
    await expect(card(page, groupA).getByTestId("sla-badge")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Grupos \(\d+\)/ })).toBeVisible();
  });

  test("atendente NÃO vê grupo restrito ao dono (lista e acesso direto)", async ({ page }) => {
    await loginAsDemoAttendant(page);
    await page.goto("/conversas");
    await expect(card(page, groupA)).toHaveCount(0);
    await expect(card(page, groupB)).toHaveCount(0);
    await page.goto(`/conversas/${groupA}`);
    await expect(page).toHaveURL(/\/conversas\?reason=access_changed$/);
  });

  test("dono libera o Grupo A no cabeçalho: atendente vê só o que veio DEPOIS; contato protegido segue oculto; Grupo B segue restrito", async ({ browser, request }) => {
    const owner = await (await browser.newContext()).newPage();
    await loginAsDemoOwner(owner);
    await owner.goto(`/conversas/${groupA}`);
    await expect(owner.getByTestId("conversation-header").getByTestId("group-mark")).toBeVisible();
    await expect(owner.getByTestId("conversation-header").getByTestId("sla-control")).toHaveCount(0);
    await owner.getByTestId("group-visibility-toggle").click();
    await expect(owner.getByTestId("group-visibility-toggle")).toHaveText("Restringir ao dono");
    expect(queryLocalSql(`select visibility from public.conversations where id = '${groupA}';`)).toBe("commercial");

    // Um membro comum e um membro PROTEGIDO escrevem depois da liberação.
    await postWebhook(request, textPayload({ jid: "120363000000000901@g.us", text: "Mensagem NOVA do membro comum", participant: MEMBER_OK, pushName: "Membro Comum", subject: "Grupo A" }));
    await postWebhook(request, textPayload({ jid: "120363000000000901@g.us", text: "Mensagem do contato PROTEGIDO", participant: MEMBER_PROTECTED, pushName: "Membro Protegido", subject: "Grupo A" }));
    queryLocalSql(`
      update public.contacts set is_protected = true, protected_at = now(), commercial_visible_from = null
      where id in (select contact_id from public.contact_points where normalized_value = '+5582988887811');
      update public.contact_points set is_protected = true, protected_at = now(), commercial_visible_from = null where normalized_value = '+5582988887811';
    `);

    const attendant = await (await browser.newContext()).newPage();
    await loginAsDemoAttendant(attendant);
    await attendant.goto("/conversas");
    await expect(card(attendant, groupA)).toBeVisible();
    await expect(card(attendant, groupB)).toHaveCount(0);
    await attendant.goto(`/conversas/${groupA}`);
    await expect(messages(attendant).getByText("Mensagem NOVA do membro comum")).toBeVisible();
    await expect(attendant.getByText("Mensagem ANTIGA do grupo A")).toHaveCount(0); // sem retroativo
    await expect(attendant.getByText("Mensagem do contato PROTEGIDO")).toHaveCount(0); // contato protegido prevalece
    await expect(attendant.getByTestId("group-visibility-toggle")).toHaveCount(0); // só o dono controla
    await expect(attendant.getByTestId("conversation-header").getByTestId("sla-badge")).toHaveCount(0);
    await expect(card(attendant, groupA).getByTestId("sla-badge")).toHaveCount(0);
    await attendant.goto(`/conversas/${groupB}`);
    await expect(attendant).toHaveURL(/\/conversas\?reason=access_changed$/);
    await owner.context().close();
    await attendant.context().close();
  });

  test("Configurações > Grupos: o dono vê todos, restringe e libera um a um; tudo fica na auditoria", async ({ page }) => {
    await loginAsDemoOwner(page);
    await page.goto("/configuracoes");
    await page.getByRole("link", { name: /^Grupos/ }).click();
    await expect(page.getByRole("heading", { name: "Grupos" })).toBeVisible();
    const rowA = page.getByTestId("group-row").filter({ hasText: "Grupo A" });
    const rowB = page.getByTestId("group-row").filter({ hasText: "Grupo B" });
    await expect(rowA.getByTestId("group-state")).toHaveText("Liberado para a equipe");
    await expect(rowB.getByTestId("group-state")).toHaveText("Restrito ao dono");

    await rowB.getByRole("button", { name: "Liberar para a equipe" }).click();
    await expect(rowB.getByTestId("group-state")).toHaveText("Liberado para a equipe");
    await rowA.getByRole("button", { name: "Restringir ao dono" }).click();
    await expect(rowA.getByTestId("group-state")).toHaveText("Restrito ao dono");
    expect(queryLocalSql(`select visibility from public.conversations where id = '${groupA}';`)).toBe("owner_only");
    expect(queryLocalSql(`select visibility from public.conversations where id = '${groupB}';`)).toBe("commercial");

    await page.goto("/configuracoes/auditoria");
    await expect(page.getByText("Grupo liberado para a equipe").first()).toBeVisible();
    await expect(page.getByText("Grupo restrito ao proprietário").first()).toBeVisible();
  });

  test("atendente só enxerga o grupo que está liberado agora", async ({ page }) => {
    await loginAsDemoAttendant(page);
    await page.goto("/conversas");
    await expect(card(page, groupB)).toBeVisible();
    await expect(card(page, groupA)).toHaveCount(0);
  });

  test("conversa consigo mesmo ('só cadastrados' ligado): entra UMA vez, sem bolha duplicada, sem prazo, e o envio e o eco não duplicam", async ({ page, request }) => {
    const jid = `${OWN}@s.whatsapp.net`;
    const payload = textPayload({ jid, text: "anotação para mim", fromMe: true, id: "SELF-ID-1" });
    expect((await postWebhook(request, payload)).ok()).toBe(true);
    expect((await postWebhook(request, payload)).ok()).toBe(true); // reenvio do mesmo evento
    const self = queryLocalSql(`select id from public.conversations where external_thread_id = '${jid}';`);
    expect(self).not.toBe("");
    expect(Number(queryLocalSql(`select count(*) from public.messages where conversation_id = '${self}';`))).toBe(1);
    expect(queryLocalSql(`select display_name from public.contacts where id in (select contact_id from public.contact_points where normalized_value = '+${OWN}');`)).toBe("Mensagens para você");

    // Outro número desconhecido segue ignorado no modo "só cadastrados".
    await postWebhook(request, textPayload({ jid: "5582988887999@s.whatsapp.net", text: "desconhecido", pushName: "Estranho" }));
    expect(Number(queryLocalSql("select count(*) from public.conversations where external_thread_id = '5582988887999@s.whatsapp.net';"))).toBe(0);

    await loginAsDemoOwner(page);
    await page.goto("/conversas");
    await expect(card(page, self).getByTestId("sla-badge")).toHaveCount(0);
    await page.goto(`/conversas/${self}`);
    await expect(messages(page).getByText("anotação para mim", { exact: true })).toHaveCount(1);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-badge")).toHaveCount(0);
    await expect(page.getByTestId("conversation-header").getByTestId("sla-control")).toHaveCount(0);

    // Envio pela tela para o próprio número: sai para a Evolution (simulada) e o eco do webhook não duplica.
    const box = page.getByLabel("Digitar mensagem de texto");
    await box.fill("resposta de teste");
    await box.press("Enter");
    await expect.poll(() => fake.requests.filter((entry) => entry.path.includes("/message/sendText/")).length, { timeout: 20_000 }).toBe(1);
    expect(String(fake.requests[0].body.number)).toBe(OWN);
    await expect(messages(page).getByTestId("message-sending")).toHaveCount(0, { timeout: 20_000 });
    const externalId = queryLocalSql(`select external_message_id from public.messages where conversation_id = '${self}' and text_content = 'resposta de teste';`);
    expect(externalId).toMatch(/^FAKE-EVO-/);
    expect((await postWebhook(request, textPayload({ jid, text: "resposta de teste", fromMe: true, id: externalId }))).ok()).toBe(true);
    expect(Number(queryLocalSql(`select count(*) from public.messages where conversation_id = '${self}' and text_content = 'resposta de teste';`))).toBe(1);
    await page.reload();
    await expect(page.getByLabel("Histórico de mensagens").getByText("resposta de teste", { exact: true })).toHaveCount(1);
  });
});
