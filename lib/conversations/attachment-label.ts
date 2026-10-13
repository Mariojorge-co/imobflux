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

/** Texto do chip de anexo: tipo, nome, tamanho (se conhecido) e orientação quando indisponível. */
export function describeAttachment(attachment: AttachmentLabelInput): { title: string; hint: string | null } {
  const kind = attachmentKindLabel(attachment.mime_type);
  const size = formatAttachmentSize(attachment.size_bytes);
  const title = [kind, attachment.file_name, size].filter(Boolean).join(" · ");
  const hint = attachment.status === "available"
    ? null
    : "Ainda não disponível no ImobFlux — tente novamente ou abra no WhatsApp para ver o arquivo.";
  return { title, hint };
}
