import { expect, test } from "@playwright/test";
import { loginAsDemoOwner, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { clearSubscriptions, insertFakeSubscription, ownerMemberId, subscriptionState } from "./helpers/push";
import { postWebhook, textPayload } from "./helpers/webhook";

// Web Push DESLIGADO (servidor sem as chaves VAPID: rode com IMOBFLUX_TEST_VAPID=off). O recurso não pode quebrar nada:
// o webhook segue normal e a tela diz que os avisos com o app fechado ainda não estão disponíveis.

test.describe("Web Push desligado (sem chaves VAPID)", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!!process.env.VAPID_PRIVATE_KEY, "este arquivo só roda com IMOBFLUX_TEST_VAPID=off");

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
  });

  test("a tela mostra 'indisponível' e não oferece o botão de ativar", async ({ page }) => {
    test.setTimeout(240_000);
    await loginAsDemoOwner(page);
    await page.goto("/preferencias");
    await expect(page.getByRole("heading", { name: "Avisos neste aparelho" })).toBeVisible();
    await expect(page.getByTestId("push-settings")).toHaveAttribute("data-push-state", "unavailable");
    await expect(page.getByTestId("push-status")).toContainText("ainda não estão disponíveis");
    await expect(page.getByTestId("push-enable")).toHaveCount(0);
    // Os avisos com o app aberto seguem na página.
    await expect(page.getByTestId("notification-settings")).toBeVisible();
  });

  test("a API recusa ativar (503) e a lista diz que não está configurado", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAsDemoOwner(page);
    const listed = (await (await page.request.get("/api/push/subscriptions")).json()) as { configured: boolean };
    expect(listed.configured).toBe(false);
    const register = await page.request.post("/api/push/subscriptions", { data: { endpoint: "https://192.0.2.50/x/aparelho", keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) } } });
    expect(register.status()).toBe(503);
    expect((await page.request.post("/api/push/test", { data: { endpoint: "https://192.0.2.50/x/aparelho" } })).status()).toBe(503);
  });

  test("o webhook segue normal e nenhuma tentativa de aviso é feita", async ({ request }) => {
    test.setTimeout(120_000);
    clearSubscriptions();
    insertFakeSubscription(ownerMemberId(), "https://192.0.2.60/push/desligado");
    const response = await postWebhook(request, textPayload({ jid: "5582988880701@s.whatsapp.net", text: "Olá", pushName: "Cliente Sem Chaves" }));
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: "success" });
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    expect(subscriptionState("https://192.0.2.60/push/desligado")).toEqual({ lastError: false, disabled: false });
  });
});
