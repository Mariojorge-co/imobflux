import { expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { demoAttendant, loginAsDemoAttendant, loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode, runLocalSql } from "./helpers/local-test-state";
import { FAKE_AUTH, FAKE_P256DH, attendantMemberId, clearSubscriptions, insertFakeSubscription, installFakePush, ownerMemberId, subscriptionState } from "./helpers/push";
import { ingestText, postWebhook, textPayload } from "./helpers/webhook";

// Web Push (com as chaves VAPID de teste, descartáveis): tela de Preferências, API, service worker (evento push e clique SIMULADOS),
// destinatários de ponta a ponta e o tempo de resposta do webhook. NADA é enviado a um serviço de push de verdade: os endpoints
// são de mentira (192.0.2.x, faixa de documentação sem rota) e a assinatura do navegador é substituída por uma falsa.

const ENDPOINT = (name: string) => `https://192.0.2.${10 + (name.length % 200)}/push/${name}`;

async function grantNotifications(context: BrowserContext) {
  await context.grantPermissions(["notifications"]);
}

// Espera o service worker estar ATIVADO e controlando a página antes de usá-lo (com servidor frio, a primeira instalação ainda podia estar
// em andamento e um evento disparado nesse intervalo se perdia). Só devolve o worker depois de provar que ele responde.
async function serviceWorkerOf(page: Page, context: BrowserContext): Promise<Worker> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null && navigator.serviceWorker.controller.state === "activated")).toBe(true);
  await expect.poll(() => context.serviceWorkers().some((worker) => worker.url().endsWith("/sw-avisos.js"))).toBe(true);
  const worker = context.serviceWorkers().find((item) => item.url().endsWith("/sw-avisos.js"))!;
  await expect.poll(() => worker.evaluate(() => (self as unknown as { registration: { active: { state: string } | null } }).registration.active?.state ?? "")).toBe("activated");
  return worker;
}

// O corpo das funções passadas a worker.evaluate roda DENTRO do service worker; estes tipos mínimos descrevem só o que o teste usa.
type WorkerNotification = { title: string; body: string; tag: string; data: unknown; renotify: boolean; close(): void };
type WorkerScope = {
  registration: { getNotifications(filter?: { tag?: string }): Promise<WorkerNotification[]> };
  dispatchEvent(event: Event): boolean;
  PushEvent: new (type: string, init: { data: Uint8Array }) => Event;
  NotificationEvent: new (type: string, init: { notification: WorkerNotification }) => Event;
};

type Shown = { title: string; body: string; tag: string; path: string | null; renotify: boolean };

async function dispatchPush(worker: Worker, payload: unknown, raw = false) {
  await worker.evaluate(
    ({ payload: value, raw: isRaw }) => {
      const text = isRaw ? String(value) : JSON.stringify(value);
      const scope = self as unknown as WorkerScope;
      scope.dispatchEvent(new scope.PushEvent("push", { data: new TextEncoder().encode(text) }));
    },
    { payload, raw },
  );
}

async function shownWithTag(worker: Worker, tag: string): Promise<Shown[]> {
  return worker.evaluate(async (wanted) => {
    const list = await (self as unknown as WorkerScope).registration.getNotifications({ tag: wanted });
    return list.map((item) => ({
      title: item.title,
      body: item.body,
      tag: item.tag,
      path: (item.data as { path?: string } | null)?.path ?? null,
      renotify: item.renotify,
    }));
  }, tag);
}

async function clearShown(worker: Worker) {
  await worker.evaluate(async () => {
    const scope = self as unknown as WorkerScope;
    for (const item of await scope.registration.getNotifications()) item.close();
  });
  // fechar é assíncrono: espera esvaziar antes do próximo aviso
  await expect
    .poll(() => worker.evaluate(async () => (await (self as unknown as WorkerScope).registration.getNotifications()).length))
    .toBe(0);
}

test.describe("Web Push", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!process.env.VAPID_PRIVATE_KEY, "o servidor de teste está sem chaves VAPID (IMOBFLUX_TEST_VAPID=off)");

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
  });

  test("aquecimento e seção 'Avisos neste aparelho' nas Preferências", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await expect(page.getByRole("heading", { name: "Avisos neste aparelho" })).toBeVisible();
    await expect(page.getByTestId("push-settings")).toContainText("nunca o texto da mensagem");
    await expect(page.getByTestId("push-settings")).toContainText("responsável");
  });

  test("ativar, listar, aviso de teste só neste aparelho e remover", async ({ browser }) => {
    test.setTimeout(180_000);
    clearSubscriptions();
    const context = await browser.newContext();
    await grantNotifications(context);
    await installFakePush(context, "ativar");
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");

    const settings = page.getByTestId("push-settings");
    await expect(settings).toHaveAttribute("data-push-state", "inactive");
    const enable = page.getByTestId("push-enable");
    await expect(enable).toBeVisible();
    await expect(enable).toHaveText(/Ativar avisos neste aparelho/);
    await enable.click();
    await expect(settings).toHaveAttribute("data-push-state", "active");
    await expect(page.getByTestId("push-message")).toContainText("Avisos ativados");
    await expect(page.getByTestId("push-device")).toHaveCount(1);
    await expect(page.getByTestId("push-device")).toContainText("Este aparelho");
    expect(queryLocalSql("select count(*) from public.push_subscriptions;")).toBe("1");
    expect(queryLocalSql("select platform from public.push_subscriptions;")).toBe("desktop");

    // Continua ativo depois de recarregar (a assinatura do navegador é a mesma).
    await page.reload();
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "active");
    await expect(page.getByTestId("push-device")).toHaveCount(1);

    // Aviso de teste: sai só para este aparelho (aqui a "entrega" falha de propósito, o endpoint é de mentira): a tela diz a verdade.
    const [testResponse] = await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/push/test")), page.getByTestId("push-test").click()]);
    expect(testResponse.status()).toBe(502);
    await expect(page.getByTestId("push-message")).toContainText("não saiu");

    // O aviso de teste de um aparelho que não é seu não existe.
    const attendant = attendantMemberId();
    const foreign = ENDPOINT("do-atendente");
    insertFakeSubscription(attendant, foreign);
    const foreignId = queryLocalSql("select id from public.push_subscriptions where endpoint = '" + foreign + "';");
    const foreignResponse = await page.request.post("/api/push/test", { data: { id: foreignId } });
    expect(foreignResponse.status()).toBe(404);

    // Opção "avisar também prazo desativado" é por aparelho e começa desligada.
    const include = page.getByTestId("push-include-disabled");
    await expect(include).not.toBeChecked();
    await include.check();
    await expect.poll(() => queryLocalSql("select include_sla_disabled::text from public.push_subscriptions where member_id = '" + ownerMemberId() + "';")).toBe("true");

    // Remover este aparelho: desliga e some da lista.
    await page.getByTestId("push-disable").click();
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "inactive");
    expect(queryLocalSql("select count(*) from public.push_subscriptions where member_id = '" + ownerMemberId() + "';")).toBe("0");
    expect(queryLocalSql("select count(*) from public.push_subscriptions where member_id = '" + attendant + "';")).toBe("1");
    await context.close();
  });

  test("API: exige login, cada pessoa só enxerga e apaga os próprios aparelhos", async ({ browser, request }) => {
    test.setTimeout(180_000);
    clearSubscriptions();
    const anonymous = await request.get("/api/push/subscriptions");
    expect(anonymous.status()).toBe(401);
    expect((await request.post("/api/push/test", { data: { id: "b6900000-0000-4000-8000-000000000001" } })).status()).toBe(401);

    insertFakeSubscription(ownerMemberId(), ENDPOINT("dono-aparelho"));
    insertFakeSubscription(attendantMemberId(), ENDPOINT("atendente-aparelho"));
    const ownerSubscriptionId = queryLocalSql("select id from public.push_subscriptions where member_id = '" + ownerMemberId() + "';");

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsDemoAttendant(page);
    const listed = (await (await page.request.get("/api/push/subscriptions")).json()) as { configured: boolean; devices: Array<Record<string, unknown>> };
    expect(listed.configured).toBe(true);
    expect(listed.devices).toHaveLength(1);
    // Nem o endpoint completo nem as chaves voltam para a tela.
    expect(JSON.stringify(listed)).not.toContain("192.0.2");
    expect(JSON.stringify(listed)).not.toContain(FAKE_P256DH);
    expect(JSON.stringify(listed)).not.toContain(FAKE_AUTH);

    // O atendente não apaga nem altera o aparelho do dono (a RLS devolve 0 linhas).
    await page.request.delete("/api/push/subscriptions", { data: { id: ownerSubscriptionId } });
    await page.request.patch("/api/push/subscriptions", { data: { id: ownerSubscriptionId, includeSlaDisabled: true } });
    expect(queryLocalSql("select count(*) from public.push_subscriptions where id = '" + ownerSubscriptionId + "';")).toBe("1");
    expect(queryLocalSql("select include_sla_disabled::text from public.push_subscriptions where id = '" + ownerSubscriptionId + "';")).toBe("false");

    // Corpo inválido é recusado, e um endpoint sem https também.
    const invalid = await page.request.post("/api/push/subscriptions", { data: { endpoint: "http://inseguro.example.test/x", keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH } } });
    expect(invalid.status()).toBe(400);

    // Origem de outro site é barrada.
    const cross = await page.request.get("/api/push/subscriptions", { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(cross.status()).toBe(403);
    await context.close();
  });

  test("service worker: aviso 'Nova mensagem de …' sem prévia, uma notificação por conversa e clique abre a conversa", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const conversationId = await ingestText(request, { jid: "5582988880601@s.whatsapp.net", text: "texto secreto do cliente", pushName: "Cliente Aviso" });
    const context = await browser.newContext();
    await grantNotifications(context);
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    const worker = await serviceWorkerOf(page, context);
    const tag = `conversa-${conversationId}`;
    const payload = { kind: "message", title: "Nova mensagem de Cliente Aviso", body: "Toque para abrir a conversa.", path: `/conversas/${conversationId}`, tag };

    await clearShown(worker);
    await dispatchPush(worker, payload);
    await expect.poll(async () => (await shownWithTag(worker, tag)).length).toBe(1);
    const [first] = await shownWithTag(worker, tag);
    expect(first).toMatchObject({ title: "Nova mensagem de Cliente Aviso", body: "Toque para abrir a conversa.", tag, path: `/conversas/${conversationId}`, renotify: true });
    expect(JSON.stringify(first)).not.toContain("secreto");

    // Segundo aviso da MESMA conversa logo depois: substitui (continua uma só) e não toca de novo.
    await dispatchPush(worker, payload);
    await expect.poll(async () => (await shownWithTag(worker, tag))[0]?.renotify).toBe(false);
    expect(await shownWithTag(worker, tag)).toHaveLength(1);

    // Conteúdo estranho nunca derruba o worker nem abre caminho de fora do app: ainda mostra UM aviso (regra do iOS).
    await clearShown(worker);
    await dispatchPush(worker, "isso não é json", true);
    await expect.poll(async () => (await shownWithTag(worker, "imobflux-aviso")).length).toBe(1);
    expect((await shownWithTag(worker, "imobflux-aviso"))[0]).toMatchObject({ title: "Nova mensagem", path: "/conversas" });
    await clearShown(worker);
    await dispatchPush(worker, { title: "Aviso", tag: "caminho-ruim", path: "//evil.example.test/x" });
    await expect.poll(async () => (await shownWithTag(worker, "caminho-ruim")).length).toBe(1);
    expect((await shownWithTag(worker, "caminho-ruim"))[0].path).toBe("/conversas");
    await clearShown(worker);
    await dispatchPush(worker, { title: "Aviso", tag: "caminho-ruim-2", path: "javascript:alert(1)" });
    await expect.poll(async () => (await shownWithTag(worker, "caminho-ruim-2")).length).toBe(1);
    expect((await shownWithTag(worker, "caminho-ruim-2"))[0].path).toBe("/conversas");

    // Clique no aviso: a conversa certa abre na janela já aberta.
    await clearShown(worker);
    await dispatchPush(worker, payload);
    await expect.poll(async () => (await shownWithTag(worker, tag)).length).toBe(1);
    await page.goto("/contatos");
    // A escuta da mensagem do aviso só existe depois da hidratação: espera a página terminar de carregar.
    await page.waitForLoadState("networkidle");
    await worker.evaluate(async (wanted) => {
      const scope = self as unknown as WorkerScope;
      const [shown] = await scope.registration.getNotifications({ tag: wanted });
      scope.dispatchEvent(new scope.NotificationEvent("notificationclick", { notification: shown }));
    }, tag);
    await expect(page).toHaveURL(new RegExp(`/conversas/${conversationId}$`));
    await expect.poll(async () => (await shownWithTag(worker, tag)).length).toBe(0);
    await context.close();
  });

  test("destinatários de ponta a ponta: sem responsável avisa só o dono; com responsável, só ele", async ({ request }) => {
    test.setTimeout(180_000);
    clearSubscriptions();
    const owner = ENDPOINT("dono-ponta");
    const attendant = ENDPOINT("atendente-ponta");
    insertFakeSubscription(ownerMemberId(), owner);
    insertFakeSubscription(attendantMemberId(), attendant);

    // Sem responsável: o servidor tenta avisar o dono (a tentativa falha de propósito, o endpoint é de mentira, e isso marca o erro).
    const first = await postWebhook(request, textPayload({ jid: "5582988880611@s.whatsapp.net", text: "Primeira", pushName: "Cliente Ponta" }));
    expect(first.status()).toBe(200);
    await expect.poll(() => subscriptionState(owner)?.lastError, { timeout: 40_000 }).toBe(true);
    expect(subscriptionState(attendant)?.lastError).toBe(false);

    // Com responsável (o atendente): agora só ele.
    runLocalSql("update public.push_subscriptions set last_error_at = null, disabled_at = null;");
    const conversation = queryLocalSql("select id from public.conversations where external_thread_id = '5582988880611@s.whatsapp.net';");
    runLocalSql(`
      insert into public.conversation_assignments (workspace_id, conversation_id, member_id, assigned_by_member_id, assigned_at)
      select workspace_id, '${conversation}', '${attendantMemberId()}', '${ownerMemberId()}', now() from public.workspace_members where id = '${ownerMemberId()}';
    `);
    const second = await postWebhook(request, textPayload({ jid: "5582988880611@s.whatsapp.net", text: "Segunda", pushName: "Cliente Ponta" }));
    expect(second.status()).toBe(200);
    await expect.poll(() => subscriptionState(attendant)?.lastError, { timeout: 40_000 }).toBe(true);
    expect(subscriptionState(owner)?.lastError).toBe(false);

    // Mensagem enviada pela equipe (do celular) nunca gera aviso.
    runLocalSql("update public.push_subscriptions set last_error_at = null;");
    const own = await postWebhook(request, textPayload({ jid: "5582988880611@s.whatsapp.net", text: "Resposta da equipe", fromMe: true }));
    expect(own.status()).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    expect(subscriptionState(attendant)?.lastError).toBe(false);
    expect(subscriptionState(owner)?.lastError).toBe(false);
  });

  test("o webhook não fica mais lento por causa do aviso (o envio roda depois da resposta)", async ({ request }) => {
    test.setTimeout(240_000);
    clearSubscriptions();
    const sample = async (label: string) => {
      const times: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const started = Date.now();
        const response = await postWebhook(request, textPayload({ jid: `55829888807${index}${label}@s.whatsapp.net`.slice(0, 40), text: "Medida", pushName: `Cliente Tempo ${label}${index}` }));
        times.push(Date.now() - started);
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ status: "success" });
      }
      return Math.min(...times);
    };
    await sample("0"); // aquecimento (compila a rota)
    const without = await sample("1");

    // 3 aparelhos do dono em endereço sem rota: cada envio fica pendurado até o limite de 6 s, mas depois da resposta.
    for (let index = 0; index < 3; index += 1) insertFakeSubscription(ownerMemberId(), ENDPOINT(`lento-${index}`));
    const withPush = await sample("2");
    expect(withPush, `sem aviso ${without} ms, com aviso ${withPush} ms`).toBeLessThan(without + 1_500);
    expect(withPush).toBeLessThan(3_000);
    // O envio de fato rodou (e falhou) em segundo plano, sem repetição.
    await expect.poll(() => subscriptionState(ENDPOINT("lento-0"))?.lastError, { timeout: 40_000 }).toBe(true);
  });

  test("webhook duplicado não avisa de novo", async ({ request }) => {
    test.setTimeout(120_000);
    clearSubscriptions();
    const endpoint = ENDPOINT("duplicado");
    insertFakeSubscription(ownerMemberId(), endpoint);
    const payload = textPayload({ jid: "5582988880621@s.whatsapp.net", text: "Mesma mensagem", pushName: "Cliente Duplicado", id: "WH-duplicado-0001" });
    expect((await postWebhook(request, payload)).status()).toBe(200);
    await expect.poll(() => subscriptionState(endpoint)?.lastError, { timeout: 40_000 }).toBe(true);
    runLocalSql("update public.push_subscriptions set last_error_at = null;");
    const again = await postWebhook(request, payload);
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ status: "duplicate" });
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    expect(subscriptionState(endpoint)?.lastError).toBe(false);
  });

  const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

  test("iPhone no navegador: orienta a instalar na Tela de Início (sem botão de ativar)", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "needs-install");
    await expect(page.getByTestId("push-install-help")).toContainText("Adicionar à Tela de Início");
    await expect(page.getByTestId("push-install-help")).toContainText("iOS 16.4");
    await expect(page.getByTestId("push-enable")).toHaveCount(0);
    await context.close();
  });

  test("iPhone com o app instalado (standalone): pode ativar", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true, configurable: true }));
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "inactive");
    await expect(page.getByTestId("push-enable")).toBeVisible();
    await context.close();
  });

  test("permissão negada: explica como reativar", async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    await context.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "denied", configurable: true }));
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "denied");
    await expect(page.getByTestId("push-denied-help")).toContainText("bloqueados");
    await expect(page.getByTestId("push-denied-help")).toContainText("cadeado");
    await context.close();
  });

  for (const width of [360, 390, 430]) {
    test(`celular ${width}px: Preferências sem rolagem lateral e botões de 44 px`, async ({ browser }) => {
      test.setTimeout(120_000);
      clearSubscriptions();
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
      await grantNotifications(context);
      await installFakePush(context, `m${width}`);
      const page = await context.newPage();
      await loginAsDemoOwner(page);
      await page.goto("/preferencias");
      await page.getByTestId("push-enable").click();
      await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "active");
      await expect(page.getByTestId("push-device")).toHaveCount(1);
      const report = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="push-settings"]')!;
        const small: string[] = [];
        for (const element of root.querySelectorAll("button, a, label")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.height < 43.5) small.push(`${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}" ${Math.round(rect.height)}px`);
        }
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          small,
          wide: [...root.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5).length,
        };
      });
      expect(report.scrollWidth).toBeLessThanOrEqual(report.innerWidth);
      expect(report.wide).toBe(0);
      expect(report.small).toEqual([]);
      await context.close();
    });
  }

  test("o atendente também tem a seção, só com os aparelhos dele", async ({ page }) => {
    test.setTimeout(120_000);
    clearSubscriptions();
    insertFakeSubscription(ownerMemberId(), ENDPOINT("dono-lista"));
    await loginAsDemoAttendant(page);
    await page.goto("/preferencias");
    await expect(page.getByRole("heading", { name: "Avisos neste aparelho" })).toBeVisible();
    await expect(page.getByTestId("push-device")).toHaveCount(0);
    expect(demoAttendant.email).toContain("atendente");
  });
});
