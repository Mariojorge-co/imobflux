import { expect, test } from "@playwright/test";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { clearSubscriptions, installFakePush } from "./helpers/push";

// Aviso de teste com atraso — navegador. A assinatura do navegador é falsa e o endpoint é de mentira (nada sai para um serviço de
// push de verdade). A espera de 10 s do servidor e o envio depois dela são cobertos nos testes unitários (relógio e envio simulados).

test.describe("Web Push: aviso de teste com atraso", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!process.env.VAPID_PRIVATE_KEY, "o servidor de teste está sem chaves VAPID (IMOBFLUX_TEST_VAPID=off)");

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    clearSubscriptions();
  });

  test("botão 'em 10 segundos': agenda na hora, mostra a confirmação e barra o segundo pedido", async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    await context.grantPermissions(["notifications"]);
    await installFakePush(context, "atraso-ui");
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await page.getByTestId("push-enable").click();
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "active");

    // Os dois botões e o texto de ajuda.
    await expect(page.getByTestId("push-test")).toHaveText("Enviar aviso de teste");
    await expect(page.getByTestId("push-test-delayed")).toHaveText("Enviar aviso de teste em 10 segundos");
    await expect(page.getByTestId("push-test-help")).toHaveText("O aviso chega em cerca de 10 segundos. Feche o app e bloqueie a tela agora.");

    // Agendar: a resposta vem na hora (202), não depois dos 10 s.
    const startedAt = Date.now();
    const [scheduled] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/push/test")),
      page.getByTestId("push-test-delayed").click(),
    ]);
    expect(scheduled.status()).toBe(202);
    expect(await scheduled.json()).toEqual({ status: "scheduled", delaySeconds: 10 });
    expect(Date.now() - startedAt).toBeLessThan(8_000);
    expect(scheduled.request().postDataJSON()).toMatchObject({ delaySeconds: 10 });
    await expect(page.getByTestId("push-message")).toContainText("Teste agendado");
    await expect(page.getByTestId("push-message")).toContainText("10 segundos");

    // Segundo pedido enquanto o primeiro está a caminho: resposta amigável (429), tanto no atrasado quanto no imediato.
    const [again] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/push/test")),
      page.getByTestId("push-test-delayed").click(),
    ]);
    expect(again.status()).toBe(429);
    await expect(page.getByTestId("push-message")).toContainText("Já há um teste a caminho");
    const [immediate] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/push/test")),
      page.getByTestId("push-test").click(),
    ]);
    expect(immediate.status()).toBe(429);
    await context.close();
  });

  test("API: exige login (401), recusa atraso fora da lista (400) e aceita 0, 10 e 20", async ({ browser, request }) => {
    test.setTimeout(180_000);
    expect((await request.post("/api/push/test", { data: { endpoint: "https://192.0.2.70/x/a", delaySeconds: 10 } })).status()).toBe(401);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    const endpoint = "https://192.0.2.70/x/a";
    for (const bad of [5, 15, 30, 60, -1, 10.5, "10", true]) {
      const response = await page.request.post("/api/push/test", { data: { endpoint, delaySeconds: bad } });
      expect(response.status(), String(bad)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain("0, 10, 20");
    }
    // Atraso válido para um aparelho que não existe: 404 (o atraso é aceito, o aparelho não).
    for (const good of [0, 10, 20]) {
      expect((await page.request.post("/api/push/test", { data: { endpoint, delaySeconds: good } })).status(), String(good)).toBe(404);
    }
    expect((await page.request.post("/api/push/test", { data: { endpoint } })).status()).toBe(404);
    await context.close();
  });

  test("celular 390px: os dois botões e o texto cabem, com alvos de 44 px", async ({ browser }) => {
    test.setTimeout(120_000);
    clearSubscriptions();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.grantPermissions(["notifications"]);
    await installFakePush(context, "atraso-mobile");
    const page = await context.newPage();
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await page.getByTestId("push-enable").click();
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "active");
    const report = await page.evaluate(() => {
      const heights = ["push-test", "push-test-delayed"].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().height);
      return { heights, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    for (const height of report.heights) expect(height).toBeGreaterThanOrEqual(43.5);
    expect(report.scrollWidth).toBeLessThanOrEqual(report.innerWidth);
    await context.close();
  });
});
