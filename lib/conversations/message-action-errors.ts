import type { GatewayOutcome } from "@/lib/conversations/gateway-outcome";

// Frases (em português) para os erros das ações sobre mensagens. Nunca carregam texto de mensagem, número nem segredo.

const BY_MESSAGE: Array<[string, string]> = [
  ["message_edit_window_expired", "O WhatsApp só permite editar até 15 minutos depois do envio. Esta mensagem passou do prazo."],
  ["message_edit_not_supported", "Só dá para editar mensagens de texto. Mensagens com arquivo não podem ser editadas."],
  ["message_edit_unchanged", "O texto não mudou."],
  ["message_text_invalid", "O texto da mensagem é inválido (vazio ou maior que 4096 caracteres)."],
  ["message_revoke_window_expired", "O WhatsApp só permite apagar para todos até 48 horas depois do envio. Esta mensagem passou do prazo."],
  ["message_action_not_authorized", "Você não tem permissão para fazer isso nesta mensagem."],
  ["message_action_not_allowed", "Esta ação não está disponível para esta mensagem."],
  ["message_not_found", "A mensagem não foi encontrada."],
  ["reaction_not_supported_group", "Reações ainda não estão disponíveis em grupos."],
  ["reaction_invalid", "Emoji inválido."],
  ["pin_limit_reached", "Você já fixou 5 conversas. Desafixe uma para fixar outra."],
  ["pin_not_authorized", "Você não tem acesso a esta conversa."],
  ["conversation_not_available", "Esta conversa não está disponível."],
  ["note_not_authorized", "Você não tem permissão para fazer isso nesta nota."],
  ["note_not_found", "A nota não foi encontrada."],
  ["internal_note_content_empty", "A nota não pode ficar vazia nem passar de 4096 caracteres."],
];

type RpcErrorLike = { message?: string | null; code?: string | null };

/** Frase para o erro devolvido por uma função do banco (pelo código escrito na mensagem do erro). */
export function messageActionErrorText(error: RpcErrorLike): string {
  const text = error.message ?? "";
  for (const [code, phrase] of BY_MESSAGE) if (text.includes(code)) return phrase;
  if (error.code === "42501") return "Você não tem permissão para fazer isso.";
  return "Não foi possível concluir a ação. Tente de novo.";
}

/**
 * Motivo da falha de uma ação que passa pelo WhatsApp (editar, apagar para todos, reagir). `nothingChanged` fecha a frase
 * dizendo o que NÃO aconteceu; no tempo esgotado a ação pode ter sido aplicada, então a frase manda conferir no celular.
 */
export function describeActionFailure(outcome: Extract<GatewayOutcome, { deliver: false }>, nothingChanged: string): string {
  switch (outcome.code) {
    case "GATEWAY_NOT_CONFIGURED":
    case "NO_INSTANCE":
    case "WHATSAPP_DISCONNECTED":
      return `O WhatsApp não está conectado ao ImobFlux agora. ${nothingChanged}`;
    case "EVOLUTION_REJECTED":
      return `O WhatsApp recusou o pedido (ele pode ter passado do prazo ou a mensagem não existe mais lá). ${nothingChanged}`;
    case "GATEWAY_TIMEOUT":
      return "O WhatsApp demorou demais para responder. A ação pode ter sido aplicada: confira no celular antes de tentar de novo.";
    case "GATEWAY_NETWORK":
      return `Não foi possível falar com o WhatsApp agora (falha de rede). ${nothingChanged}`;
    case "INVALID_RECIPIENT":
      return `O número desta conversa não é válido para o WhatsApp. ${nothingChanged}`;
    default:
      return `O WhatsApp respondeu de forma inesperada. ${nothingChanged}`;
  }
}
