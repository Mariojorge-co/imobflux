import "server-only";

import { after } from "next/server";
import webpush from "web-push";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { deliverPush, summaryLine, type DeliveryDeps, type PushTarget, type SendOutcome } from "./delivery";
import { readVapidConfig, type VapidConfig } from "./config";

/** Tempo máximo de cada envio (o serviço de push costuma responder em menos de 1 s). Sem repetição. */
export const PUSH_TIMEOUT_MS = 6_000;
/** Quanto tempo o serviço de push guarda o aviso se o aparelho estiver sem rede (1 hora; depois disso ele perde a graça). */
const PUSH_TTL_SECONDS = 60 * 60;

/** Envia UM aviso a UMA assinatura. Nunca lança; devolve só o código HTTP em caso de erro. */
export async function sendWebPush(
  vapid: VapidConfig,
  subscription: { endpoint: string; p256dh: string; auth: string },
  body: string,
): Promise<SendOutcome> {
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      body,
      {
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: PUSH_TTL_SECONDS,
        urgency: "high",
        timeout: PUSH_TIMEOUT_MS,
      },
    );
    return { ok: true };
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    return { ok: false, statusCode: typeof statusCode === "number" ? statusCode : null };
  }
}

function adminDeps(vapid: VapidConfig): DeliveryDeps {
  const admin = createAdminSupabaseClient();
  return {
    send: (target, body) => sendWebPush(vapid, target, body),
    markGone: async (ids) => {
      await admin.from("push_subscriptions").update({ disabled_at: new Date().toISOString(), last_error_at: new Date().toISOString() }).in("id", ids);
    },
    markError: async (ids) => {
      await admin.from("push_subscriptions").update({ last_error_at: new Date().toISOString() }).in("id", ids);
    },
  };
}

/**
 * Avisa quem deve receber uma mensagem nova de cliente. Chamado DEPOIS da resposta ao webhook (`after`): melhor esforço, sem
 * repetição, e nunca lança. Só contagens e códigos vão para o log (nunca texto, endpoint completo ou chave).
 */
export async function notifyNewMessage(messageId: string): Promise<void> {
  const vapid = readVapidConfig();
  if (!vapid) return;
  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("get_push_targets", { p_message_id: messageId });
    if (error) {
      console.error("[push] não foi possível escolher os destinatários (código):", error.code ?? "desconhecido");
      return;
    }
    const targets = (Array.isArray(data) ? data : []) as PushTarget[];
    if (targets.length === 0) return;
    const summary = await deliverPush(targets, adminDeps(vapid));
    console.log(summaryLine(summary));
  } catch (error) {
    console.error("[push] falha inesperada ao avisar:", error instanceof Error ? error.name : "erro");
  }
}

/** Agenda o aviso para depois da resposta ao webhook. Sem chaves VAPID não faz nada; fora de uma requisição roda em segundo plano. */
export function scheduleNewMessagePush(messageId: string): void {
  if (!readVapidConfig()) return;
  try {
    after(() => notifyNewMessage(messageId));
  } catch {
    void notifyNewMessage(messageId);
  }
}
