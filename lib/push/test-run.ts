// Aviso de teste (com ou sem atraso): regra pura, sem rede nem banco. O que fala com o mundo entra por `deps`, o que permite testar
// atraso válido/inválido, limite de abuso e "só para o aparelho que pediu" sem enviar nada. Só contagens e códigos saem daqui.

import { buildTestPayload } from "./payload";
import type { SendOutcome } from "./delivery";

/** Atrasos aceitos, em segundos. Qualquer outro valor é recusado (nunca um atraso arbitrário). */
export const ALLOWED_DELAYS = [0, 10, 20] as const;
export type TestDelay = (typeof ALLOWED_DELAYS)[number];

/** Intervalo mínimo entre dois pedidos de teste do mesmo aparelho. */
export const MIN_INTERVAL_MS = 5_000;
/** Um teste "pendente" que nunca terminou (função encerrada) deixa de bloquear depois disto. */
export const PENDING_EXPIRY_MS = 60_000;

/** `undefined`/`null` = sem atraso. Número inteiro fora da lista, texto, decimal, negativo: `null` (recusado). */
export function parseDelay(value: unknown): TestDelay | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return (ALLOWED_DELAYS as readonly number[]).includes(value) ? (value as TestDelay) : null;
}

export type LimiterDecision = { ok: true; release: () => void } | { ok: false; reason: "pending" | "too_soon"; retryAfterSeconds: number };

type Entry = { startedAt: number; pending: boolean };

/**
 * No máximo 1 teste pendente por aparelho e um intervalo mínimo entre pedidos. Fica na memória da instância: é um freio simples
 * contra clique repetido, não uma garantia entre instâncias.
 */
export function createTestLimiter(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  return {
    start(subscriptionId: string): LimiterDecision {
      const current = now();
      for (const [key, entry] of entries) {
        if (current - entry.startedAt > PENDING_EXPIRY_MS) entries.delete(key);
      }
      const previous = entries.get(subscriptionId);
      if (previous) {
        const wait = Math.max(1, Math.ceil((previous.startedAt + MIN_INTERVAL_MS - current) / 1000));
        if (previous.pending) return { ok: false, reason: "pending", retryAfterSeconds: wait };
        if (current - previous.startedAt < MIN_INTERVAL_MS) return { ok: false, reason: "too_soon", retryAfterSeconds: wait };
      }
      const entry: Entry = { startedAt: current, pending: true };
      entries.set(subscriptionId, entry);
      return {
        ok: true,
        release: () => {
          entry.pending = false;
        },
      };
    },
  };
}

export type TestSubscription = { id: string; endpoint: string; p256dh: string; auth: string; disabled_at: string | null };

export type TestRunDeps = {
  configured: boolean;
  /** Só enxerga as assinaturas da própria pessoa (a RLS cuida disso). */
  findSubscription: (endpoint: string) => Promise<TestSubscription | null>;
  /** Envia UM aviso a UMA assinatura. Nunca lança. */
  send: (subscription: TestSubscription, body: string) => Promise<SendOutcome>;
  /** 404/410 num teste imediato: a pessoa está na requisição, então apaga a própria assinatura (como antes). */
  removeNow: (subscriptionId: string) => Promise<void>;
  /** 404/410 num teste com atraso: já não há sessão da pessoa, então só desativa a assinatura. */
  disableLater: (subscriptionId: string) => Promise<void>;
  /** Roda depois da resposta (after). */
  later: (task: () => Promise<void>) => void;
  sleep: (ms: number) => Promise<void>;
  limiter: ReturnType<typeof createTestLimiter>;
  log: (line: string) => void;
};

export type TestRunResult = { status: number; body: Record<string, unknown> };

export async function runPushTest(deps: TestRunDeps, endpoint: string, rawDelay: unknown): Promise<TestRunResult> {
  if (!deps.configured) return { status: 503, body: { error: "Os avisos com o app fechado ainda não estão disponíveis." } };
  const delay = parseDelay(rawDelay);
  if (delay === null) return { status: 400, body: { error: `Atraso inválido. Use ${ALLOWED_DELAYS.join(", ")} segundos.` } };

  const subscription = await deps.findSubscription(endpoint);
  if (!subscription || subscription.disabled_at) return { status: 404, body: { status: "not_registered" } };

  const slot = deps.limiter.start(subscription.id);
  if (!slot.ok) {
    return {
      status: 429,
      body: {
        status: slot.reason,
        retryAfterSeconds: slot.retryAfterSeconds,
        error: slot.reason === "pending" ? "Já há um teste a caminho. Aguarde o aviso chegar." : "Aguarde alguns segundos antes de pedir outro teste.",
      },
    };
  }

  const body = JSON.stringify(buildTestPayload());

  if (delay > 0) {
    deps.later(async () => {
      try {
        await deps.sleep(delay * 1000);
        const outcome = await deps.send(subscription, body);
        if (outcome.ok) deps.log(`[push] teste com atraso de ${delay}s: enviado`);
        else {
          deps.log(`[push] teste com atraso de ${delay}s: falha codigo=${outcome.statusCode ?? "rede"}`);
          if (outcome.statusCode === 404 || outcome.statusCode === 410) await deps.disableLater(subscription.id);
        }
      } catch {
        deps.log(`[push] teste com atraso de ${delay}s: erro inesperado`);
      } finally {
        slot.release();
      }
    });
    return { status: 202, body: { status: "scheduled", delaySeconds: delay } };
  }

  try {
    const outcome = await deps.send(subscription, body);
    if (outcome.ok) return { status: 200, body: { status: "sent" } };
    if (outcome.statusCode === 404 || outcome.statusCode === 410) {
      await deps.removeNow(subscription.id);
      return { status: 410, body: { status: "gone" } };
    }
    return { status: 502, body: { status: "failed", code: outcome.statusCode } };
  } finally {
    slot.release();
  }
}
