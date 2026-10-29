// Web Push: envio em paralelo, melhor esforço, SEM repetição. Só contagens e códigos de erro saem daqui (nunca conteúdo, endpoint
// completo nem chave). A parte que fala com a rede e com o banco entra por `deps`, o que permite testar a regra sem enviar nada.

import { buildMessagePayload, type PushPayload } from "./payload";

export type PushTarget = {
  subscription_id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  conversation_id: string;
  contact_name: string;
};

export type SendOutcome = { ok: true } | { ok: false; statusCode: number | null };

export type DeliveryDeps = {
  /** Envia um aviso a UM aparelho. Nunca deve lançar: erros viram `{ ok: false }`. */
  send: (target: PushTarget, body: string) => Promise<SendOutcome>;
  /** O serviço de push disse que o aparelho não existe mais (404/410): desativa a assinatura. */
  markGone: (subscriptionIds: string[]) => Promise<void>;
  /** Qualquer outra falha: só registra o momento do erro. */
  markError: (subscriptionIds: string[]) => Promise<void>;
};

export type DeliverySummary = {
  targets: number;
  sent: number;
  gone: number;
  failed: number;
  /** Contagem por código HTTP (ou "rede" quando não houve resposta). */
  codes: Record<string, number>;
};

/** Teto de aparelhos por mensagem: o aviso é para o responsável, então o normal é 1 a 3. */
export const MAX_TARGETS = 50;

/** 404 e 410 = a assinatura não vale mais (o aparelho desinstalou, limpou os dados ou revogou a permissão). */
export function isGoneStatus(statusCode: number | null): boolean {
  return statusCode === 404 || statusCode === 410;
}

export function summaryLine(summary: DeliverySummary): string {
  const codes = Object.entries(summary.codes)
    .map(([code, count]) => `${code}:${count}`)
    .join(",");
  return `[push] aparelhos=${summary.targets} enviados=${summary.sent} desativados=${summary.gone} falhas=${summary.failed} codigos=${codes || "-"}`;
}

export async function deliverPush(
  targets: PushTarget[],
  deps: DeliveryDeps,
  buildPayload: (target: PushTarget) => PushPayload = (target) => buildMessagePayload(target.conversation_id, target.contact_name),
): Promise<DeliverySummary> {
  const unique = [...new Map(targets.map((target) => [target.subscription_id, target])).values()].slice(0, MAX_TARGETS);
  const summary: DeliverySummary = { targets: unique.length, sent: 0, gone: 0, failed: 0, codes: {} };
  if (unique.length === 0) return summary;

  const results = await Promise.all(
    unique.map(async (target) => {
      try {
        return { target, outcome: await deps.send(target, JSON.stringify(buildPayload(target))) };
      } catch {
        return { target, outcome: { ok: false, statusCode: null } as SendOutcome };
      }
    }),
  );

  const gone: string[] = [];
  const failed: string[] = [];
  for (const { target, outcome } of results) {
    if (outcome.ok) {
      summary.sent += 1;
      continue;
    }
    const code = outcome.statusCode === null ? "rede" : String(outcome.statusCode);
    summary.codes[code] = (summary.codes[code] ?? 0) + 1;
    if (isGoneStatus(outcome.statusCode)) {
      summary.gone += 1;
      gone.push(target.subscription_id);
    } else {
      summary.failed += 1;
      failed.push(target.subscription_id);
    }
  }

  try {
    if (gone.length > 0) await deps.markGone(gone);
    if (failed.length > 0) await deps.markError(failed);
  } catch {
    // marcar o estado é secundário: o aviso já foi tentado
  }
  return summary;
}
