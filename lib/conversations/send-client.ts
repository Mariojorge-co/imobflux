"use client";

import { sendMessageAction } from "@/lib/conversations/actions";
import { retryOutgoingMediaAction, sendOutgoingMediaAction } from "@/lib/conversations/media-send";
import type { ConversationMessage } from "@/lib/conversations/data";
import { buildPendingMediaMessage } from "@/lib/conversations/message-merge";
import { mediaLabel, mediaTypeFor, type MediaKind } from "@/lib/conversations/outgoing-files";
import { enqueueSend, enqueueTextSend, type SendHandlers } from "@/lib/conversations/send-queue";

/** Envia um texto pela fila da conversa usando a server action real. */
export function sendTextQueued(conversationId: string, text: string, handlers: SendHandlers) {
  return enqueueTextSend({ conversationId, text, handlers, send: sendMessageAction });
}

export type MediaToSend = {
  /** Caminho do arquivo já guardado no Storage. */
  path: string;
  name: string;
  mime: string;
  size: number;
  kind: MediaKind;
  caption: string;
  asDocument: boolean;
  previewUrl: string | null;
};

/** Envia um arquivo (já guardado no Storage) pela MESMA fila dos textos: a ordem de chegada ao WhatsApp é preservada. */
export function sendMediaQueued(conversationId: string, media: MediaToSend, handlers: SendHandlers) {
  const idempotencyKey = crypto.randomUUID();
  const caption = media.caption.trim();
  const text = caption || mediaLabel(mediaTypeFor(media.kind, media.asDocument), media.name);
  const pending = buildPendingMediaMessage({
    idempotencyKey,
    text,
    fileName: media.name,
    mimeType: media.mime,
    sizeBytes: media.size,
    previewUrl: media.previewUrl,
  });
  return enqueueSend({
    conversationId,
    pending,
    handlers,
    run: () =>
      sendOutgoingMediaAction({
        conversationId,
        path: media.path,
        fileName: media.name,
        caption,
        asDocument: media.asDocument,
        idempotencyKey,
      }),
  });
}

/** "Tentar de novo" de um arquivo que falhou: nova mensagem (nova chave) na fila, com cópia do mesmo arquivo. */
export function retryMediaQueued(conversationId: string, failed: ConversationMessage, handlers: SendHandlers) {
  const idempotencyKey = crypto.randomUUID();
  const attachment = failed.attachments?.[0];
  const pending = buildPendingMediaMessage({
    idempotencyKey,
    text: failed.text_content ?? "",
    fileName: attachment?.file_name ?? "arquivo",
    mimeType: attachment?.mime_type ?? "application/octet-stream",
    sizeBytes: attachment?.size_bytes ?? 0,
    previewUrl: null,
  });
  return enqueueSend({
    conversationId,
    pending,
    handlers,
    run: () => retryOutgoingMediaAction({ messageId: failed.id, idempotencyKey }),
  });
}
