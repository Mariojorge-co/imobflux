// Regras puras de tipo de mídia (sem dependências de servidor), usadas pelo download e pela tela.

export const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // mesmo limite do bucket

export type ViewerKind = "image" | "pdf" | "audio" | "video" | "file";

/** Tipos que o navegador pode exibir com segurança dentro da conversa. SVG/HTML nunca são "inline". */
export function viewerKindForMime(mimeType: string | null | undefined): ViewerKind {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/svg+xml") return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

const UNSAFE_RENDER_MIME = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;

/**
 * Content-Type usado ao guardar/servir. Arquivos de clientes são não confiáveis: tipos que o
 * navegador executaria (HTML, SVG, XML, JS) viram octet-stream e nunca são renderizados.
 */
export function safeContentType(mimeType: string | null | undefined): string {
  const mime = (mimeType ?? "").trim();
  if (!mime || UNSAFE_RENDER_MIME.test(mime) || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(\s*;.*)?$/i.test(mime)) {
    return "application/octet-stream";
  }
  return mime.slice(0, 127);
}

/** Um pending com mais de 5 min não está mais "baixando": a tela passa a oferecer nova tentativa. */
export const PENDING_STALE_AFTER_MS = 5 * 60 * 1000;

export function isDownloadInProgress(
  attachment: { status: string; created_at?: string },
  now: number = Date.now(),
): boolean {
  if (attachment.status !== "pending") return false;
  if (!attachment.created_at) return true;
  const created = new Date(attachment.created_at).getTime();
  return Number.isFinite(created) ? now - created < PENDING_STALE_AFTER_MS : true;
}
