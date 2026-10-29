import { readVapidConfig } from "@/lib/push/config";
import { pushJson, pushRouteContext, readJson } from "@/lib/push/api";
import { buildTestPayload } from "@/lib/push/payload";
import { sendWebPush } from "@/lib/push/server";
import { isValidEndpoint } from "@/lib/push/validate";

// Aviso de teste SÓ para o aparelho que pediu (o endpoint dele), e só se a assinatura for da própria pessoa (a RLS devolve
// apenas as dela). Não toca em nenhuma conversa nem lê mensagem.

export const maxDuration = 15;

export async function POST(request: Request) {
  const context = await pushRouteContext(request);
  if (context.error) return context.error;
  const vapid = readVapidConfig();
  if (!vapid) return pushJson({ error: "Os avisos com o app fechado ainda não estão disponíveis." }, 503);
  const body = (await readJson(request)) as { endpoint?: unknown } | null;
  if (!isValidEndpoint(body?.endpoint)) return pushJson({ error: "Aparelho inválido." }, 400);

  const { data } = await context.supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, disabled_at")
    .eq("endpoint", body.endpoint)
    .maybeSingle();
  if (!data || data.disabled_at) return pushJson({ status: "not_registered" }, 404);

  const outcome = await sendWebPush(vapid, data, JSON.stringify(buildTestPayload()));
  if (outcome.ok) return pushJson({ status: "sent" });
  if (outcome.statusCode === 404 || outcome.statusCode === 410) {
    await context.supabase.from("push_subscriptions").delete().eq("id", data.id);
    return pushJson({ status: "gone" }, 410);
  }
  return pushJson({ status: "failed", code: outcome.statusCode }, 502);
}
