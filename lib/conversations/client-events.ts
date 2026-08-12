import type { ConversationMessage } from "@/lib/conversations/data";

export const CONVERSATION_CLIENT_UPDATE_EVENT = "imobflux:conversation-update";

export type ConversationClientUpdate = {
  conversationId: string;
  isUnread?: boolean;
  message?: ConversationMessage;
  participantName?: string;
};

export function emitConversationClientUpdate(detail: ConversationClientUpdate) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<ConversationClientUpdate>(CONVERSATION_CLIENT_UPDATE_EVENT, {
      detail,
    }),
  );
}
