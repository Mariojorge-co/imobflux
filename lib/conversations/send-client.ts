"use client";

import { sendMessageAction } from "@/lib/conversations/actions";
import {
  prepareOutgoingUploadAction,
  retryOutgoingMediaAction,
  sendOutgoingMediaAction,
  sendVoiceNoteAction,
} from "@/lib/conversations/media-send";
import type { ConversationMessage } from "@/lib/conversations/data";
import { buildPendingMediaMessage, type ReplyRef } from "@/lib/conversations/message-merge";
import { mediaLabel, mediaTypeFor, type MediaKind } from "@/lib/conversations/outgoing-files";
import { enqueueSend, enqueueTextSend, type SendHandlers } from "@/lib/conversations/send-queue";
import { UploadError, uploadToSignedUrl } from "@/lib/conversations/upload-client";

/** Envia um texto pela fila da conversa usando a server action real. */
export function sendTextQueued(conversationId: string, text: string, handlers: SendHandlers, replyTo?: ReplyRef | null) {
  return enqueueTextSend({ conversationId, text, handlers, send: sendMessageAction, replyTo });
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
export function sendMediaQueued(conversationId: string, media: MediaToSend, handlers: SendHandlers, replyTo?: ReplyRef | null) {
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
    reply: replyTo,
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
        replyToMessageId: replyTo?.messageId ?? null,
      }),
  });
}

export type VoiceToSend = {
  /** A gravação (o envio sobe o arquivo e depois pede o envio como mensagem de voz). */
  blob: Blob;
  /** Nome com a extensão do formato gravado (ex.: voz.webm). */
  fileName: string;
  durationSeconds: number;
};

/**
 * Envia uma gravação de voz (PTT) pela MESMA fila dos textos e arquivos: a bolha "enviando…" aparece na hora, o arquivo sobe
 * direto ao Storage e o servidor pede o envio como mensagem de voz. Falha em qualquer etapa vira "não enviada" com o motivo.
 */
export function sendVoiceQueued(conversationId: string, voice: VoiceToSend, handlers: SendHandlers, replyTo?: ReplyRef | null) {
  const idempotencyKey = crypto.randomUUID();
  const pending = buildPendingMediaMessage({
    idempotencyKey,
    text: mediaLabel("audio", voice.fileName),
    fileName: voice.fileName,
    mimeType: voice.blob.type || "audio/webm",
    sizeBytes: voice.blob.size,
    previewUrl: null,
    reply: replyTo,
  });
  return enqueueSend({
    conversationId,
    pending,
    handlers,
    run: async () => {
      const prepared = await prepareOutgoingUploadAction({ conversationId, fileName: voice.fileName, size: voice.blob.size });
      if (!prepared.success) return { success: false as const, error: prepared.error, code: prepared.code };
      try {
        await uploadToSignedUrl(prepared.signedUrl, voice.blob, () => undefined).promise;
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof UploadError ? error.message : "Falha ao enviar o áudio.",
          code: "UPLOAD_ERROR",
        };
      }
      return sendVoiceNoteAction({
        conversationId,
        path: prepared.path,
        durationSeconds: voice.durationSeconds,
        idempotencyKey,
        replyToMessageId: replyTo?.messageId ?? null,
      });
    },
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
