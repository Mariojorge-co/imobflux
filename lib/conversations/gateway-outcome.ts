export type GatewayResultLike =
  | { success: true }
  | { success: false; code?: string; error?: string };

/** Motivo da falha de envio, um por causa distinta (a tela mostra a frase correspondente). */
export type GatewayFailureCode =
  | "GATEWAY_NOT_CONFIGURED"
  | "NO_INSTANCE"
  | "WHATSAPP_DISCONNECTED"
  | "EVOLUTION_REJECTED"
  | "GATEWAY_TIMEOUT"
  | "GATEWAY_NETWORK"
  | "INVALID_RECIPIENT"
  | "GATEWAY_ERROR";

export type GatewayOutcome =
  | { deliver: true; source: "gateway" | "local_bypass" }
  | { deliver: false; code: GatewayFailureCode; error: string };

type EnvLike = Record<string, string | undefined>;

// Códigos devolvidos por sendEvolutionTextMessage quando o ambiente não tem WhatsApp configurado.
const NOT_CONFIGURED_CODES = new Set(["MISSING_ENV_CONFIG", "MISSING_INSTANCE"]);

/** Código da conexão desativada no banco (não vem do gateway: é decidido antes, ao resolver a instância). */
export const WHATSAPP_DISCONNECTED_CODE = "WHATSAPP_DISCONNECTED";

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
 *
 * As frases são fixas e em português: nunca carregam o corpo da resposta da Evolution, o texto da mensagem,
 * o número do cliente nem segredo. O código curto (ex.: HTTP_400) é o único detalhe técnico mostrado.
 */
export function classifyGatewayOutcome(
  result: GatewayResultLike,
  env: EnvLike = process.env,
): GatewayOutcome {
  if (result.success) return { deliver: true, source: "gateway" };

  const code = result.code ?? "";
  if (NOT_CONFIGURED_CODES.has(code)) {
    if (isLocalGatewayBypassAllowed(env)) return { deliver: true, source: "local_bypass" };
    if (code === "MISSING_INSTANCE") {
      return {
        deliver: false,
        code: "NO_INSTANCE",
        error: "Não há um WhatsApp configurado para enviar: falta a instância deste ambiente. Conecte o número em Configurações > WhatsApp ou peça ao responsável técnico. A mensagem não foi enviada.",
      };
    }
    return {
      deliver: false,
      code: "GATEWAY_NOT_CONFIGURED",
      error: "A integração com o WhatsApp não está configurada neste ambiente (servidor da Evolution). A mensagem não foi enviada.",
    };
  }

  if (code === WHATSAPP_DISCONNECTED_CODE) {
    return {
      deliver: false,
      code: "WHATSAPP_DISCONNECTED",
      error: "O WhatsApp está desconectado do ImobFlux. Conecte o número em Configurações > WhatsApp e tente de novo. A mensagem não foi enviada.",
    };
  }

  const http = /^HTTP_([0-9]{3})$/.exec(code);
  if (http) {
    const hint = http[1] === "401" || http[1] === "403" ? " (chave de acesso recusada)" : "";
    return {
      deliver: false,
      code: "EVOLUTION_REJECTED",
      error: `O WhatsApp recusou o envio${hint} (código ${code}). A mensagem não foi enviada. Se continuar, avise o responsável técnico com este código.`,
    };
  }

  if (code === "TIMEOUT") {
    return {
      deliver: false,
      code: "GATEWAY_TIMEOUT",
      error: "O WhatsApp demorou demais para responder. A mensagem pode ter sido enviada: confira no celular antes de tentar de novo.",
    };
  }

  if (code === "NETWORK_ERROR") {
    return {
      deliver: false,
      code: "GATEWAY_NETWORK",
      error: "Não foi possível falar com o WhatsApp agora (falha de rede). A mensagem não foi enviada. Tente novamente em instantes.",
    };
  }

  if (code === "INVALID_PHONE") {
    return {
      deliver: false,
      code: "INVALID_RECIPIENT",
      error: "O número desta conversa não é válido para envio pelo WhatsApp. A mensagem não foi enviada.",
    };
  }

  if (code === "MISSING_EXTERNAL_ID" || code === "INVALID_JSON_RESPONSE") {
    return {
      deliver: false,
      code: "GATEWAY_ERROR",
      error: "O WhatsApp respondeu de forma inesperada. A mensagem pode ter sido enviada: confira no celular antes de tentar de novo.",
    };
  }

  return { deliver: false, code: "GATEWAY_ERROR", error: "Falha ao enviar mensagem via WhatsApp" };
}
