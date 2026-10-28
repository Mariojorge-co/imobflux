import { isMediaTooLarge, MAX_MEDIA_LABEL } from "@/lib/conversations/media-types";

export type AttachmentLabelInput = {
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
};

export type AttachmentKindLabel = "PDF" | "Imagem" | "Áudio" | "Vídeo" | "Documento";

export function attachmentKindLabel(mimeType: string): AttachmentKindLabel {
  const mime = mimeType.toLowerCase();
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Imagem";
  if (mime.startsWith("audio/")) return "Áudio";
  if (mime.startsWith("video/")) return "Vídeo";
  return "Documento";
}

export function formatAttachmentSize(sizeBytes: number): string | null {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Nomes que o ImobFlux dá quando o WhatsApp não manda nome ("video", "audio"…): repetir o tipo seria ruído ("Vídeo · video"). */
const GENERIC_FILE_NAMES = new Set(["video", "audio", "imagem", "image", "documento", "document", "figurinha", "sticker"]);

/** Texto do chip de anexo: tipo, nome (se for um nome de verdade), tamanho (se conhecido) e orientação quando indisponível. */
export function describeAttachment(attachment: AttachmentLabelInput): { title: string; hint: string | null; tooLarge: boolean } {
  const kind = attachmentKindLabel(attachment.mime_type);
  const size = formatAttachmentSize(attachment.size_bytes);
  const name = GENERIC_FILE_NAMES.has(attachment.file_name.trim().toLowerCase()) ? null : attachment.file_name;
  const title = [kind, name, size].filter(Boolean).join(" · ");
  const tooLarge = attachment.status !== "available" && isMediaTooLarge(attachment.size_bytes);
  const hint = attachment.status === "available"
    ? null
    : tooLarge
      ? `Arquivo grande demais para o ImobFlux (${size}; limite ${MAX_MEDIA_LABEL}). Abra no WhatsApp.`
      : "Ainda não disponível no ImobFlux — tente de novo ou abra no WhatsApp para ver o arquivo.";
  return { title, hint, tooLarge };
}
