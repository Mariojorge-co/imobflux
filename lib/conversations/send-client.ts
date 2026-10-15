"use client";

import { sendMessageAction } from "@/lib/conversations/actions";
import { enqueueTextSend, type SendHandlers } from "@/lib/conversations/send-queue";

/** Envia um texto pela fila da conversa usando a server action real. */
export function sendTextQueued(conversationId: string, text: string, handlers: SendHandlers) {
  return enqueueTextSend({ conversationId, text, handlers, send: sendMessageAction });
}
