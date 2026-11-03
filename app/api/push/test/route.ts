import { after } from "next/server";
import { readVapidConfig } from "@/lib/push/config";
import { pushJson, pushRouteContext, readJson } from "@/lib/push/api";
import { sendWebPush } from "@/lib/push/server";
import { createTestLimiter, runPushTest } from "@/lib/push/test-run";
import { isValidEndpoint } from "@/lib/push/validate";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// Aviso de teste SÓ para o aparelho que pediu (o endpoint dele), e só se a assinatura for da própria pessoa (a RLS devolve
// apenas as dela). Não toca em nenhuma conversa nem lê mensagem. Com `delaySeconds` (0, 10 ou 20) responde na hora e envia
// depois, no servidor (`after`): o app pode estar fechado. A regra está em lib/push/test-run.ts.

// Atraso máximo (20 s) + tempo máximo do envio (6 s) cabem em 30 s. Só esta rota; as demais não mudam.
export const maxDuration = 30;

const limiter = createTestLimiter();

export async function POST(request: Request) {
  const context = await pushRouteContext(request);
  if (context.error) return context.error;
  const vapid = readVapidConfig();
  const body = (await readJson(request)) as { endpoint?: unknown; delaySeconds?: unknown } | null;
  if (vapid && !isValidEndpoint(body?.endpoint)) return pushJson({ error: "Aparelho inválido." }, 400);

  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const supabase = context.supabase;
  const result = await runPushTest(
    {
      configured: vapid !== null,
      findSubscription: async (deviceEndpoint) => {
        const { data } = await supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth, disabled_at")
          .eq("endpoint", deviceEndpoint)
          .maybeSingle();
        return data;
      },
      send: (subscription, payload) => sendWebPush(vapid!, subscription, payload),
      removeNow: async (id) => {
        await supabase.from("push_subscriptions").delete().eq("id", id);
      },
      disableLater: async (id) => {
        const now = new Date().toISOString();
        await createAdminSupabaseClient().from("push_subscriptions").update({ disabled_at: now, last_error_at: now }).eq("id", id);
      },
      later: (task) => after(task),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      limiter,
      log: (line) => console.log(line),
    },
    endpoint,
    body?.delaySeconds,
  );
  return pushJson(result.body, result.status);
}
