import { expect, test, type Page } from "@playwright/test";
import { loginAsDemoAttendant, loginAsDemoOwner, resetAndLoadDemoMode, runLocalSql } from "./helpers/local-test-state";
import { expandSection } from "./helpers/hoje";
import { ingestText } from "./helpers/webhook";

// Hoje unificado: /prioridades virou /hoje. Ordem de ação das seções, contadores sem duplicar, higiene de cadastro por último e
// recolhida, "ver mais", redirect permanente e o celular (360/390/430) sem rolagem lateral, com alvos de toque de 44 px.

const SECTION_ORDER = ["hoje-waiting", "hoje-due-followups", "hoje-tasks", "hoje-new", "hoje-awaiting-client", "hoje-hygiene"];
const DUO_JID = "5582988880401@s.whatsapp.net";
let duoConversation = "";
let baseline = 0;

async function actionCount(page: Page): Promise<number> {
  const text = await page.getByTestId("hoje-counter-action").innerText();
  return Number((text.match(/[0-9]+/) ?? ["-1"])[0]);
}

test.describe("Hoje unificado", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
  });

  test("aquecimento e linha de base do contador 'Para agir agora'", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    baseline = await actionCount(page);
    expect(baseline).toBeGreaterThanOrEqual(0);
  });

  test("as seções aparecem na ordem de ação e a higiene de cadastro é a última", async ({ page, request }) => {
    test.setTimeout(180_000);
    duoConversation = await ingestText(request, { jid: DUO_JID, text: "Quero visitar o apartamento", pushName: "Cliente Duplo" });
    // Um follow-up devido do MESMO cliente: ele fica em 3 seções (aguardando, follow-up devido, nova sem atendimento)…
    runLocalSql(`
      insert into public.work_tasks (id, workspace_id, task_type, title, status, priority, due_at, contact_id, conversation_id, created_by_member_id)
      select 'd7000001-0000-4000-8000-000000000001', conversation.workspace_id, 'follow_up', 'Ligar para o Cliente Duplo', 'pending', 'normal',
             now() - interval '1 hour', point.contact_id, conversation.id,
             (select id from public.workspace_members where workspace_id = conversation.workspace_id and role = 'owner' limit 1)
      from public.conversations as conversation
      join public.conversation_participants as participant on participant.conversation_id = conversation.id and participant.left_at is null
      join public.contact_points as point on point.id = participant.contact_point_id
      where conversation.id = '${duoConversation}' limit 1;
    `);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await expandSection(page, "hoje-waiting");
    await expect(page.getByTestId("hoje-waiting").getByTestId("hoje-conversation").filter({ hasText: "Cliente Duplo" })).toBeVisible();

    const order = await page.evaluate((ids) => {
      const tops = ids.map((id) => {
        const top = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().top;
        return top === undefined ? -1 : top + window.scrollY;
      });
      return { tops, sorted: [...tops].sort((a, b) => a - b) };
    }, SECTION_ORDER);
    expect(order.tops.every((top) => top >= 0), "todas as seções existem").toBe(true);
    expect(order.tops, "ordem de cima para baixo").toEqual(order.sorted);
    // O contador do topo vem antes de todas as seções.
    const countersTop = await page.getByTestId("hoje-counters").evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
    expect(countersTop).toBeLessThan(order.tops[0]);

    // Cada seção tem título, contagem e estado vazio/lista.
    for (const id of SECTION_ORDER.slice(0, 5)) {
      await expect(page.getByTestId(id).getByRole("heading").first()).toBeVisible();
      await expect(page.getByTestId(`${id}-count`)).toBeVisible();
    }
    await expect(page.getByTestId("hoje-due-followups")).toContainText("Ligar para o Cliente Duplo");
    await expandSection(page, "hoje-new");
    await expect(page.getByTestId("hoje-new").getByTestId("hoje-new-item").filter({ hasText: "Cliente Duplo" })).toBeVisible();
  });

  test("o mesmo cliente em várias seções soma uma vez só no contador de cima", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await expandSection(page, "hoje-waiting");
    await expandSection(page, "hoje-new");
    const sections = ["hoje-waiting", "hoje-due-followups", "hoje-new"];
    for (const id of sections) await expect(page.getByTestId(id)).toContainText("Cliente Duplo");
    // Aguardando + follow-up devido + nova sem atendimento = 3 linhas, mas 1 pessoa: o contador sobe exatamente 1.
    expect(await actionCount(page)).toBe(baseline + 1);
    // O follow-up devido não repete na lista de tarefas.
    await expect(page.getByTestId("hoje-tasks")).not.toContainText("Ligar para o Cliente Duplo");
    // Os contadores do dia continuam (recebidas, enviadas, novas, concluídas) e não conflitam com "Para agir agora".
    for (const id of ["incoming", "outgoing", "new", "tasks"]) await expect(page.getByTestId(`hoje-counter-${id}`)).toBeVisible();
  });

  test("a higiene de cadastro vem recolhida e abre com os quatro grupos", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    const details = page.getByTestId("hoje-hygiene-details");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(page.getByTestId("hoje-hygiene-pending")).toBeHidden();
    await expect(page.getByTestId("hoje-hygiene-count")).toBeVisible();
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    for (const id of ["pending", "nophone", "stale", "new"]) await expect(page.getByTestId(`hoje-hygiene-${id}`)).toBeVisible();
    for (const title of ["Pendentes de qualificação", "Sem telefone", "Leads sem revisão recente", "Novos nos últimos 7 dias"]) {
      await expect(details.getByText(title).first()).toBeVisible();
    }
  });

  test("lista longa mostra 'Ver mais' e expande tudo", async ({ page, request }) => {
    test.setTimeout(240_000);
    for (let index = 0; index < 8; index += 1) {
      await ingestText(request, { jid: `558298888050${index}@s.whatsapp.net`, text: `Mensagem ${index}`, pushName: `Cliente Lista ${index}` });
    }
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    const waiting = page.getByTestId("hoje-waiting");
    const total = Number((await page.getByTestId("hoje-waiting-count").innerText()).trim());
    expect(total).toBeGreaterThan(6);
    await expect(waiting.getByTestId("hoje-conversation")).toHaveCount(6);
    const more = waiting.getByTestId("hoje-see-more");
    await expect(more).toContainText(`Ver mais (${total - 6})`);
    await more.click();
    await expect(waiting.getByTestId("hoje-conversation")).toHaveCount(total);
    await expect(more).toContainText("Ver menos");
  });

  test("/prioridades redireciona (permanente) para /hoje e o menu não tem mais Prioridades", async ({ page, request }) => {
    test.setTimeout(120_000);
    const response = await request.get("/prioridades", { maxRedirects: 0 });
    expect([301, 308]).toContain(response.status());
    expect(new URL(response.headers()["location"], "http://localhost").pathname).toBe("/hoje");

    await loginAsDemoOwner(page);
    await page.goto("/prioridades");
    await expect(page).toHaveURL(/\/hoje$/);
    await expect(page.getByRole("heading", { name: "Hoje", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Hoje" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Prioridades" })).toHaveCount(0);
  });

  test("o atendente vê as mesmas seções, sem o filtro da equipe", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoAttendant(page);
    await page.goto("/hoje");
    await expect(page.getByTestId("hoje-filter")).toHaveCount(0);
    for (const id of SECTION_ORDER) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("hoje-hygiene-details")).not.toHaveAttribute("open", "");
  });

  for (const width of [360, 390, 430]) {
    test(`celular ${width}px: sem rolagem lateral, alvos de 44 px e sem sobreposição`, async ({ browser }) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await loginAsDemoOwner(page);
      await page.goto("/hoje");
      await expect(page.getByTestId("hoje-counters")).toBeVisible();
      await page.getByTestId("hoje-hygiene-details").locator("summary").click();
      await expect(page.getByTestId("hoje-hygiene-pending")).toBeVisible();

      const report = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="hoje-sections"]')!;
        const small: string[] = [];
        for (const element of root.querySelectorAll("a, button, summary")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.height < 43.5) small.push(`${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(rect.height)}px`);
        }
        const boxes = ["hoje-waiting", "hoje-due-followups", "hoje-tasks", "hoje-new", "hoje-awaiting-client", "hoje-hygiene"].map((id) => {
          const rect = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
          return { id, top: rect.top, bottom: rect.bottom };
        });
        const overlaps = boxes.slice(1).filter((box, index) => box.top < boxes[index].bottom - 0.5).map((box) => box.id);
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          small,
          overlaps,
          wide: [...root.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5).length,
        };
      });
      expect(report.scrollWidth, "sem rolagem lateral").toBeLessThanOrEqual(report.innerWidth);
      expect(report.wide, "nada passa da borda direita").toBe(0);
      expect(report.overlaps, "seções não se sobrepõem").toEqual([]);
      expect(report.small, "alvos de toque < 44 px").toEqual([]);
      await context.close();
    });
  }

  test("computador 1440px: sem rolagem lateral e a higiene continua recolhida", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/hoje");
    await expect(page.getByTestId("hoje-counters")).toBeVisible();
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.inner);
    await expect(page.getByTestId("hoje-hygiene-details")).not.toHaveAttribute("open", "");
    await context.close();
  });

});
