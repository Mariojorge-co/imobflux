import { expect, test } from "@playwright/test";
import {
  ALLOWED_DELAYS,
  MIN_INTERVAL_MS,
  PENDING_EXPIRY_MS,
  createTestLimiter,
  parseDelay,
  runPushTest,
  type TestRunDeps,
  type TestSubscription,
} from "../lib/push/test-run";
import type { SendOutcome } from "../lib/push/delivery";

// Aviso de teste com atraso: atraso válido/inválido, recurso desligado, limite de abuso e "só o aparelho que pediu". Nada sai pela rede.
// O aparelho é sempre pedido pelo ID e procurado só entre os da própria pessoa; endpoint informado pelo cliente não é aceito.

const MINE: TestSubscription = { id: "b6900000-0000-4000-8000-000000000001", endpoint: "https://push.example.test/mine", p256dh: "p", auth: "a", disabled_at: null };
const OTHER: TestSubscription = { id: "b6900000-0000-4000-8000-000000000002", endpoint: "https://push.example.test/other", p256dh: "p", auth: "a", disabled_at: null };

function harness(overrides: { outcome?: SendOutcome; configured?: boolean; signedIn?: boolean; subscriptions?: TestSubscription[]; clock?: { now: number } } = {}) {
  const clock = overrides.clock ?? { now: 1_000_000 };
  const sent: Array<{ subscriptionId: string; endpoint: string; body: string }> = [];
  const slept: number[] = [];
  const removed: string[] = [];
  const disabled: string[] = [];
  const logs: string[] = [];
  const queue: Array<() => Promise<void>> = [];
  const subscriptions = overrides.subscriptions ?? [MINE];
  const deps: TestRunDeps = {
    signedIn: overrides.signedIn ?? true,
    configured: overrides.configured ?? true,
    findSubscription: async (subscriptionId) => subscriptions.find((item) => item.id === subscriptionId) ?? null,
    send: async (subscription, body) => {
      sent.push({ subscriptionId: subscription.id, endpoint: subscription.endpoint, body });
      return overrides.outcome ?? { ok: true };
    },
    removeNow: async (id) => void removed.push(id),
    disableLater: async (id) => void disabled.push(id),
    later: (task) => void queue.push(task),
    sleep: async (ms) => void slept.push(ms),
    limiter: createTestLimiter(() => clock.now),
    log: (line) => void logs.push(line),
  };
  return { deps, sent, slept, removed, disabled, logs, queue, clock };
}

test.describe("Aviso de teste: atraso", () => {
  test("lista fechada de atrasos: 0, 10 e 20; qualquer outro valor é recusado", () => {
    expect([...ALLOWED_DELAYS]).toEqual([0, 10, 20]);
    expect(parseDelay(undefined)).toBe(0);
    expect(parseDelay(null)).toBe(0);
    expect(parseDelay(0)).toBe(0);
    expect(parseDelay(10)).toBe(10);
    expect(parseDelay(20)).toBe(20);
    for (const bad of [5, 15, 30, 60, -10, 10.5, NaN, Infinity, "10", "0", true, [], {}, 1e9]) expect(parseDelay(bad), String(bad)).toBeNull();
  });

  test("atraso inválido: erro claro (400), nada agendado e nada enviado", async () => {
    const h = harness();
    const result = await runPushTest(h.deps, MINE.id, 7);
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain("0, 10, 20");
    expect(h.queue).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  test("atraso de 10 s: responde 202 na hora e só envia depois, no servidor", async () => {
    const h = harness();
    const result = await runPushTest(h.deps, MINE.id, 10);
    expect(result).toEqual({ status: 202, body: { status: "scheduled", delaySeconds: 10 } });
    expect(h.sent).toHaveLength(0);
    expect(h.queue).toHaveLength(1);
    await h.queue[0]();
    expect(h.slept).toEqual([10_000]);
    expect(h.sent).toHaveLength(1);
    expect(h.logs).toEqual(["[push] teste com atraso de 10s: enviado"]);
  });

  test("atraso de 20 s funciona e sem atraso envia na hora (200)", async () => {
    const delayed = harness();
    expect((await runPushTest(delayed.deps, MINE.id, 20)).status).toBe(202);
    await delayed.queue[0]();
    expect(delayed.slept).toEqual([20_000]);

    const now = harness();
    expect(await runPushTest(now.deps, MINE.id, undefined)).toEqual({ status: 200, body: { status: "sent" } });
    expect(now.queue).toHaveLength(0);
    expect(now.slept).toHaveLength(0);
    expect(now.sent).toHaveLength(1);
  });

  test("não autenticado: 401 antes de tudo, sem procurar aparelho nem agendar", async () => {
    const h = harness({ signedIn: false });
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(401);
    expect((await runPushTest(h.deps, MINE.id, 7)).status).toBe(401);
    expect(h.queue).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  test("endpoint no lugar do id não acha nada (o cliente não escolhe aparelho por endpoint)", async () => {
    const h = harness();
    expect((await runPushTest(h.deps, MINE.endpoint, 0)).status).toBe(404);
    expect(h.sent).toHaveLength(0);
  });

  test("recurso desligado: 503 antes de qualquer outra coisa", async () => {
    const h = harness({ configured: false });
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(503);
    expect((await runPushTest(h.deps, MINE.id, 7)).status).toBe(503);
    expect(h.queue).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  test("o envio vai só ao aparelho que pediu; aparelho de outra pessoa ou inexistente dá 404", async () => {
    const h = harness({ subscriptions: [MINE] });
    // OTHER não está entre as assinaturas visíveis para esta pessoa (a RLS esconde): nada sai.
    const foreign = await runPushTest(h.deps, OTHER.id, 10);
    expect(foreign.status).toBe(404);
    expect(h.queue).toHaveLength(0);
    expect((await runPushTest(h.deps, "b6900000-0000-4000-8000-000000000999", 0)).status).toBe(404);

    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(202);
    await h.queue[0]();
    expect(h.sent.map((item) => item.subscriptionId)).toEqual([MINE.id]);
  });

  test("assinatura desativada não recebe teste", async () => {
    const h = harness({ subscriptions: [{ ...MINE, disabled_at: "2026-11-01T00:00:00Z" }] });
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(404);
    expect(h.sent).toHaveLength(0);
  });

  test("o conteúdo do teste é genérico: nada de cliente, conversa ou prévia", async () => {
    const h = harness();
    await runPushTest(h.deps, MINE.id, 0);
    const payload = JSON.parse(h.sent[0].body) as Record<string, string>;
    expect(payload.kind).toBe("test");
    expect(payload.title).toBe("Aviso de teste do ImobFlux");
    expect(payload.path).toBe("/preferencias");
    expect(h.sent[0].body).not.toMatch(/conversa-|Nova mensagem/);
  });

  test("falha no envio com atraso: log só com código, 410 desativa e o espaço é liberado", async () => {
    const h = harness({ outcome: { ok: false, statusCode: 410 } });
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(202);
    await h.queue[0]();
    expect(h.logs).toEqual(["[push] teste com atraso de 10s: falha codigo=410"]);
    expect(h.disabled).toEqual([MINE.id]);
    expect(h.removed).toEqual([]);
    for (const line of h.logs) expect(line).not.toContain("push.example.test");

    const network = harness({ outcome: { ok: false, statusCode: null } });
    await runPushTest(network.deps, MINE.id, 10);
    await network.queue[0]();
    expect(network.logs).toEqual(["[push] teste com atraso de 10s: falha codigo=rede"]);
    expect(network.disabled).toEqual([]);
  });

  test("teste imediato: 410 apaga a assinatura da pessoa e 502 devolve o código", async () => {
    const gone = harness({ outcome: { ok: false, statusCode: 404 } });
    expect((await runPushTest(gone.deps, MINE.id, 0)).status).toBe(410);
    expect(gone.removed).toEqual([MINE.id]);

    const failed = harness({ outcome: { ok: false, statusCode: 503 } });
    expect(await runPushTest(failed.deps, MINE.id, 0)).toEqual({ status: 502, body: { status: "failed", code: 503 } });
  });
});

test.describe("Aviso de teste: limite de abuso", () => {
  test("1 teste pendente por aparelho: o segundo pedido durante a espera recebe 429 'pending'", async () => {
    const h = harness();
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(202);
    h.clock.now += MIN_INTERVAL_MS + 1000; // mesmo passado o intervalo, continua pendente até o envio
    const second = await runPushTest(h.deps, MINE.id, 10);
    expect(second.status).toBe(429);
    expect(second.body.status).toBe("pending");
    expect(String(second.body.error)).toContain("a caminho");
    expect(h.queue).toHaveLength(1);
  });

  test("intervalo mínimo: pedido cedo demais recebe 429 'too_soon' com o tempo de espera; depois passa", async () => {
    const h = harness();
    expect((await runPushTest(h.deps, MINE.id, 0)).status).toBe(200);
    h.clock.now += 1000;
    const early = await runPushTest(h.deps, MINE.id, 0);
    expect(early.status).toBe(429);
    expect(early.body.status).toBe("too_soon");
    expect(early.body.retryAfterSeconds).toBe(4);
    expect(String(early.body.error)).toContain("Aguarde");
    expect(h.sent).toHaveLength(1);

    h.clock.now += MIN_INTERVAL_MS;
    expect((await runPushTest(h.deps, MINE.id, 0)).status).toBe(200);
    expect(h.sent).toHaveLength(2);
  });

  test("depois que o envio com atraso termina e o intervalo passa, um novo teste é aceito", async () => {
    const h = harness();
    await runPushTest(h.deps, MINE.id, 10);
    await h.queue[0]();
    h.clock.now += MIN_INTERVAL_MS;
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(202);
  });

  test("o limite é por aparelho: outro aparelho não é bloqueado", async () => {
    const h = harness({ subscriptions: [MINE, OTHER] });
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(202);
    expect((await runPushTest(h.deps, OTHER.id, 10)).status).toBe(202);
  });

  test("teste pendente que nunca terminou (função encerrada) deixa de bloquear depois de 1 minuto", async () => {
    const h = harness();
    await runPushTest(h.deps, MINE.id, 10);
    h.clock.now += PENDING_EXPIRY_MS + 1000;
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(202);
  });

  test("pedidos recusados por atraso inválido ou aparelho desconhecido não gastam o limite", async () => {
    const h = harness();
    await runPushTest(h.deps, MINE.id, 99);
    await runPushTest(h.deps, "b6900000-0000-4000-8000-000000000999", 10);
    expect((await runPushTest(h.deps, MINE.id, 10)).status).toBe(202);
  });
});
