import { isPushConfigured } from "@/lib/push/config";
import { pushJson, pushRouteContext, readJson } from "@/lib/push/api";
import { isUuid, isValidEndpoint, parseSubscriptionBody } from "@/lib/push/validate";

// Aparelhos da PRÓPRIA pessoa com aviso ligado. A RLS do banco garante que ninguém vê nem mexe nas assinaturas de outra pessoa;
// o endpoint e as chaves nunca voltam na resposta (só os últimos caracteres do endpoint, para marcar "este aparelho").

export async function GET(request: Request) {
  const context = await pushRouteContext(request);
  if (context.error) return context.error;
  const { data, error } = await context.supabase
    .from("push_subscriptions")
    .select("id, endpoint, platform, user_agent, created_at, last_seen_at, last_error_at, disabled_at, include_sla_disabled")
    .order("created_at", { ascending: true });
  if (error) return pushJson({ error: "Não foi possível listar os aparelhos." }, 500);
  const devices = (data ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    lastErrorAt: row.last_error_at,
    disabled: row.disabled_at !== null,
    includeSlaDisabled: row.include_sla_disabled,
    endpointTail: row.endpoint.slice(-12),
  }));
  return pushJson({ configured: isPushConfigured(), devices });
}

export async function POST(request: Request) {
  const context = await pushRouteContext(request);
  if (context.error) return context.error;
  if (!isPushConfigured()) return pushJson({ error: "Os avisos com o app fechado ainda não estão disponíveis." }, 503);
  const input = parseSubscriptionBody(await readJson(request));
  if (!input) return pushJson({ error: "Dados do aparelho inválidos." }, 400);
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 200);
  const { data, error } = await context.supabase.rpc("register_push_subscription", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: userAgent,
    p_platform: input.platform ?? "desktop",
  });
  const result = data as { success?: boolean; status?: string; subscription_id?: string } | null;
  if (error || !result?.success) return pushJson({ error: "Não foi possível ativar os avisos neste aparelho." }, error ? 500 : 400);
  return pushJson({ ok: true, id: result.subscription_id });
}

export async function DELETE(request: Request) {
  const context = await pushRouteContext(request);
  if (context.error) return context.error;
  const body = (await readJson(request)) as { id?: unknown; endpoint?: unknown } | null;
  if (isUuid(body?.id)) {
    const { error } = await context.supabase.from("push_subscriptions").delete().eq("id", body.id);
    return error ? pushJson({ error: "Não foi possível remover o aparelho." }, 500) : pushJson({ ok: true });
  }
  if (isValidEndpoint(body?.endpoint)) {
    const { error } = await context.supabase.from("push_subscriptions").delete().eq("endpoint", body.endpoint);
    return error ? pushJson({ error: "Não foi possível remover o aparelho." }, 500) : pushJson({ ok: true });
  }
  return pushJson({ error: "Informe o aparelho." }, 400);
}

export async function PATCH(request: Request) {
  const context = await pushRouteContext(request);
  if (context.error) return context.error;
  const body = (await readJson(request)) as { id?: unknown; includeSlaDisabled?: unknown } | null;
  if (!isUuid(body?.id) || typeof body?.includeSlaDisabled !== "boolean") return pushJson({ error: "Dados inválidos." }, 400);
  const { error } = await context.supabase.from("push_subscriptions").update({ include_sla_disabled: body.includeSlaDisabled }).eq("id", body.id);
  return error ? pushJson({ error: "Não foi possível salvar." }, 500) : pushJson({ ok: true });
}
