import type { ConversationMessage } from "@/lib/conversations/data";

export const CONVERSATION_CLIENT_UPDATE_EVENT = "imobflux:conversation-update";

export type ConversationClientUpdate = {
  conversationId: string;
  isUnread?: boolean;
  message?: ConversationMessage;
  participantName?: string;
  /** Mudança do prazo da conversa (pausa/desativação/reativação), para a lista se atualizar sem recarregar. */
  sla?: {
    sla_mode: string;
    sla_paused_at: string | null;
    sla_applies: boolean;
    sla_direction: string | null;
    sla_at: string | null;
  };
};

export function emitConversationClientUpdate(detail: ConversationClientUpdate) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<ConversationClientUpdate>(CONVERSATION_CLIENT_UPDATE_EVENT, {
      detail,
    }),
  );
}
