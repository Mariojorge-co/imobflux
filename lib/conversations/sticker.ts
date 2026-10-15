// Detecção de figurinha (sticker) sem migration: a recepção grava o anexo com nome "figurinha" e mime image/webp
// (o stickerMessage da Evolution não traz nome de arquivo) e o texto da mensagem é o rótulo "Figurinha".

export const STICKER_FILE_NAME = "figurinha";
export const STICKER_LABEL = "Figurinha";

/** Tamanho máximo (em pixels) da figurinha na conversa. */
export const STICKER_MAX_PX = 140;
/** Foto na conversa: limite no MAIOR lado (largura ou altura), celular e desktop; a proporção é preservada. */
export const IMAGE_MAX_SIDE_MOBILE_PX = 180;
export const IMAGE_MAX_SIDE_DESKTOP_PX = 220;
/** Altura máxima de vídeo na conversa: celular e desktop. */
export const MEDIA_MAX_HEIGHT_MOBILE_PX = 220;
export const MEDIA_MAX_HEIGHT_DESKTOP_PX = 280;

type StickerCandidate = { file_name?: string | null; mime_type?: string | null };

/**
 * É figurinha? Exige imagem webp E (nome "figurinha" OU texto "Figurinha" sem legenda). Foto comum (jpeg/png) e
 * imagem com legenda de verdade nunca são tratadas como figurinha.
 */
export function isStickerAttachment(attachment: StickerCandidate, messageText?: string | null): boolean {
  const mime = (attachment.mime_type ?? "").toLowerCase().split(";")[0].trim();
  if (mime !== "image/webp") return false;
  const name = (attachment.file_name ?? "").trim().toLowerCase();
  const text = (messageText ?? "").trim();
  return name === STICKER_FILE_NAME || text === STICKER_LABEL;
}

/** A mensagem é só uma figurinha (um único anexo, sem outro texto além do rótulo)? */
export function isStickerMessage(message: { text_content?: string | null; attachments?: StickerCandidate[] | null }): boolean {
  const attachments = message.attachments ?? [];
  if (attachments.length !== 1) return false;
  return isStickerAttachment(attachments[0], message.text_content);
}
