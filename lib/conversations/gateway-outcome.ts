export type GatewayResultLike =
  | { success: true }
  | { success: false; code?: string; error?: string };

export type GatewayOutcome =
  | { deliver: true; source: "gateway" | "local_bypass" }
  | { deliver: false; code: "GATEWAY_NOT_CONFIGURED" | "GATEWAY_ERROR"; error: string };

type EnvLike = Record<string, string | undefined>;

// Códigos devolvidos por sendEvolutionTextMessage quando o ambiente não tem WhatsApp configurado.
const NOT_CONFIGURED_CODES = new Set(["MISSING_ENV_CONFIG", "MISSING_INSTANCE"]);

/**
 * Contorno local para desenvolvimento/demo sem Evolution: nunca vale em produção.
 */
export function isLocalGatewayBypassAllowed(env: EnvLike = process.env): boolean {
  return env.NODE_ENV !== "production"
    && (env.NODE_ENV === "development" || env.NEXT_PUBLIC_DEMO_MODE === "true");
}

/**
 * Decide se uma mensagem pode ser marcada como enviada. Só o aceite real do gateway
 * conta como envio; falhas reais (timeout, HTTP, rede) nunca viram sucesso. Somente
 * "gateway não configurado" fora de produção pode ser contornado em dev/demo.
 */
export function classifyGatewayOutcome(
  result: GatewayResultLike,
  env: EnvLike = process.env,
): GatewayOutcome {
  if (result.success) return { deliver: true, source: "gateway" };

  const code = result.code ?? "";
  if (NOT_CONFIGURED_CODES.has(code)) {
    if (isLocalGatewayBypassAllowed(env)) return { deliver: true, source: "local_bypass" };
    return {
      deliver: false,
      code: "GATEWAY_NOT_CONFIGURED",
      error: "O WhatsApp ainda não está conectado ao ImobFlux. A mensagem não foi enviada.",
    };
  }

  if (code === "TIMEOUT" || code === "NETWORK_ERROR") {
    return {
      deliver: false,
      code: "GATEWAY_ERROR",
      error: "Não foi possível falar com o WhatsApp agora. A mensagem não foi enviada.",
    };
  }

  return { deliver: false, code: "GATEWAY_ERROR", error: "Falha ao enviar mensagem via WhatsApp" };
}
