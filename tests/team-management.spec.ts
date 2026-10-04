import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  loginAsDemoAttendant,
  loginAsDemoOwner,
  resetAndLoadDemoMode,
  runLocalSql,
} from "./helpers/local-test-state";

test.describe("Gestão de Equipe OWNER × ATTENDANT", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await resetAndLoadDemoMode();
  });

  test("OWNER lista a equipe e convite real permite ao funcionário definir a própria senha", async ({ browser, request }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await loginAsDemoOwner(ownerPage);
    await ownerPage.goto("/configuracoes/equipe");

    await expect(ownerPage.getByRole("table").getByText("Corretor ImobFlux")).toBeVisible();
    await expect(ownerPage.getByRole("table").getByText("Atendente Demo")).toBeVisible();
    await expect(ownerPage.getByText("OWNER", { exact: true }).first()).toBeVisible();

    const invitedEmail = `equipe-${Date.now()}@example.test`;
    await ownerPage.getByRole("button", { name: "Adicionar funcionário" }).click();
    await ownerPage.getByLabel("Nome").fill("Funcionário Convidado");
    await ownerPage.getByLabel("E-mail").fill(invitedEmail);
    await ownerPage.getByRole("button", { name: "Enviar convite" }).click();
    await expect(ownerPage.getByText(/Convite criado/)).toBeVisible();
    await expect(ownerPage.getByText(invitedEmail).first()).toBeVisible();

    const inviteLink = await findInviteLink(request, invitedEmail);
    const invitedContext = await browser.newContext();
    const invitedPage = await invitedContext.newPage();
    await invitedPage.goto(inviteLink);
    await expect(invitedPage.getByRole("heading", { name: "Aceitar convite" })).toBeVisible();
    await invitedPage.getByLabel("Crie sua senha").fill("Funcionario-pass!9");
    await invitedPage.getByLabel("Confirme sua senha").fill("Funcionario-pass!9");
    await invitedPage.getByRole("button", { name: "Definir senha e entrar" }).click();
    await expect(invitedPage).toHaveURL(/\/prioridades$/);

    await ownerPage.reload();
    const invitedRow = ownerPage.getByText(invitedEmail).first().locator("xpath=ancestor::tr");
    await expect(invitedRow.getByText("Ativo", { exact: true })).toBeVisible();

    await invitedContext.close();
    await ownerContext.close();
  });

  test("ATTENDANT não administra equipe e respeita contatos, grupos e histórico temporal", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsDemoAttendant(page);

    await page.goto("/configuracoes/equipe");
    await expect(page).toHaveURL(/\/prioridades\?reason=owner_required$/);
    await expect(page.getByRole("link", { name: "Configurações" })).toHaveCount(0);

    await page.goto("/contatos");
    await expect(page.getByRole("table").getByText("DEMO — Cliente Público", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("table").getByText("DEMO — Cliente Liberado Agora", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("DEMO — Cliente Privado")).toHaveCount(0);

    await page.goto("/conversas/d3300003-0000-4000-8000-000000000003");
    await expect(page.getByLabel("Histórico de mensagens").getByText("DEMO — Mensagem posterior à liberação")).toBeVisible();
    await expect(page.getByText("Consegue agendar a visita na cobertura")).toHaveCount(0);

    await page.goto("/conversas/d3300003-0000-4000-8000-000000000022");
    await expect(page.getByLabel("Histórico de mensagens").getByText("DEMO — Grupo após o marco")).toBeVisible();
    await expect(page.getByText("DEMO — Grupo antes do marco")).toHaveCount(0);

    await page.goto("/conversas/d3300003-0000-4000-8000-000000000021");
    await expect(page).toHaveURL(/\/conversas\?reason=access_changed$/);
    await context.close();
  });

  test("duas sessões revogam acesso por inativação e por mudança de privacidade", async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const attendantContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const attendantPage = await attendantContext.newPage();
    await Promise.all([loginAsDemoOwner(ownerPage), loginAsDemoAttendant(attendantPage)]);

    await attendantPage.goto("/conversas/d3300003-0000-4000-8000-000000000001");
    await expect(attendantPage.getByText("DEMO — Cliente Público").first()).toBeVisible();

    await ownerPage.goto("/contatos?q=DEMO%20%E2%80%94%20Cliente%20P%C3%BAblico");
    const publicContactRow = ownerPage.getByRole("table").getByRole("row").filter({ hasText: "DEMO — Cliente Público" }).first();
    await publicContactRow.getByRole("button", { name: /Ações secundárias/i }).click();
    await ownerPage.getByRole("menuitem", { name: "Tornar OWNER-only" }).click();
    await publicContactRow.getByRole("button", { name: /Ações secundárias/i }).click();
    await expect(ownerPage.getByRole("menuitem", { name: "Visível para equipe" })).toBeVisible();
    await ownerPage.keyboard.press("Escape");

    runLocalSql(`
      insert into public.messages (
        id, workspace_id, channel_connection_id, conversation_id, external_message_id,
        direction, origin, sender_contact_point_id, text_content, status,
        occurred_at, external_created_at, received_at, created_at
      ) select
        'd3500007-0000-4000-8000-000000000001', workspace_id, channel_connection_id,
        id, 'team-private-realtime', 'incoming', 'whatsapp',
        'd3300004-0000-4000-8000-000000000001', 'NÃO PODE VAZAR APÓS PRIVACIDADE',
        'received', now(), now(), now(), now()
      from public.conversations where id = 'd3300003-0000-4000-8000-000000000001';
    `);
    await expect(attendantPage.getByText("NÃO PODE VAZAR APÓS PRIVACIDADE")).toHaveCount(0);

    await attendantPage.reload();
    await expect(attendantPage).toHaveURL(/\/conversas\?reason=access_changed$/);

    await ownerPage.goto("/configuracoes/equipe");
    await attendantPage.goto("/conversas/d3300003-0000-4000-8000-000000000003");
    const attendantRow = ownerPage.getByText("atendente@imobflux.local").first().locator("xpath=ancestor::tr");
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await attendantRow.getByRole("button", { name: "Desativar acesso" }).click();
    await expect(attendantRow.getByText("Inativo", { exact: true })).toBeVisible();

    runLocalSql(`
      insert into public.messages (
        id, workspace_id, channel_connection_id, conversation_id, external_message_id,
        direction, origin, sender_contact_point_id, text_content, status,
        occurred_at, external_created_at, received_at, created_at
      ) select
        'd3500007-0000-4000-8000-000000000002', workspace_id, channel_connection_id,
        id, 'team-inactive-realtime', 'incoming', 'whatsapp',
        'd3300004-0000-4000-8000-000000000003', 'NÃO PODE VAZAR APÓS INATIVAÇÃO',
        'received', now(), now(), now(), now()
      from public.conversations where id = 'd3300003-0000-4000-8000-000000000003';
    `);
    await expect(attendantPage.getByText("NÃO PODE VAZAR APÓS INATIVAÇÃO")).toHaveCount(0);

    await attendantPage.goto("/contatos");
    await expect(attendantPage).toHaveURL(/\/login\?reason=access_denied$/);

    await attendantRow.getByRole("button", { name: "Reativar funcionário" }).click();
    await expect(attendantRow.getByText("Ativo", { exact: true })).toBeVisible();

    await ownerPage.goto("/contatos?q=DEMO%20%E2%80%94%20Cliente%20P%C3%BAblico");
    const privateContactRow = ownerPage.getByRole("table").getByRole("row").filter({ hasText: "DEMO — Cliente Público" }).first();
    await privateContactRow.getByRole("button", { name: /Ações secundárias/i }).click();
    await ownerPage.getByRole("menuitem", { name: "Visível para equipe" }).click();
    await privateContactRow.getByRole("button", { name: /Ações secundárias/i }).click();
    await expect(ownerPage.getByRole("menuitem", { name: "Tornar OWNER-only" })).toBeVisible();
    await ownerPage.keyboard.press("Escape");

    await attendantPage.goto("/prioridades");
    await expect(attendantPage).toHaveURL(/\/prioridades$/);

    await ownerContext.close();
    await attendantContext.close();
  });
});

async function findInviteLink(request: APIRequestContext, email: string) {
  const inbucketUrl = process.env.IMOBFLUX_INBUCKET_URL || "http://127.0.0.1:54324";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const listResponse = await request.get(`${inbucketUrl}/api/v1/messages`);
    if (listResponse.ok()) {
      const list = await listResponse.json() as {
        messages?: Array<{ ID: string; To?: Array<{ Address?: string }> }>;
      };
      const message = list.messages?.find((candidate) =>
        candidate.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
      );
      if (message) {
        const detailResponse = await request.get(`${inbucketUrl}/api/v1/message/${message.ID}`);
        const detail = await detailResponse.json() as { HTML?: string; Text?: string };
        const content = detail.HTML || detail.Text || "";
        const match = content.match(/https?:\/\/[^"'<\s]+\/auth\/(?:confirm|v1\/verify)\?[^"'<\s]+/i);
        if (match) {
          const appOrigin = process.env.IMOBFLUX_APP_ORIGIN || "http://localhost:3000";
          const inviteUrl = new URL(match[0].replaceAll("&amp;", "&"));
          if (inviteUrl.pathname === "/auth/v1/verify") {
            const token = inviteUrl.searchParams.get("token");
            if (!token) continue;
            return `${appOrigin}/auth/confirm?token_hash=${encodeURIComponent(token)}&type=invite&next=/convite`;
          }
          inviteUrl.protocol = new URL(appOrigin).protocol;
          inviteUrl.host = new URL(appOrigin).host;
          return inviteUrl.toString();
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Convite local não encontrado para ${email}`);
}
