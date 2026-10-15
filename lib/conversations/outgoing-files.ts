// Regras dos arquivos enviados ao cliente pelo WhatsApp. Funções puras: o mesmo código valida no navegador (aviso
// rápido) e no servidor (decisão final, com os primeiros bytes do arquivo JÁ guardado). Nada aqui confia no tipo que o
// navegador informou: o tipo vem da extensão E do conteúdo (bytes mágicos), e os dois precisam concordar.

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_BATCH = 10;
/** Quantos bytes do início do arquivo bastam para reconhecer o tipo. */
export const HEAD_BYTES = 4096;

export type MediaKind = "image" | "video" | "audio" | "document";

/** Famílias de conteúdo reconhecidas pelos bytes mágicos. */
export type ContentFamily =
  | "jpeg" | "png" | "gif" | "webp" | "bmp" | "heic" | "tiff"
  | "pdf" | "zip" | "ole" | "rtf" | "rar" | "7z" | "gzip"
  | "mp4" | "webm" | "avi"
  | "mp3" | "ogg" | "wav" | "flac" | "amr" | "aac"
  | "text"
  | "executable" | "unknown";

type TypeRule = { kind: MediaKind; mime: string; families: ContentFamily[] };

/** Extensões aceitas → tipo de mídia, mime que será enviado e famílias de conteúdo que a extensão admite. */
const ALLOWED: Record<string, TypeRule> = {
  jpg: { kind: "image", mime: "image/jpeg", families: ["jpeg"] },
  jpeg: { kind: "image", mime: "image/jpeg", families: ["jpeg"] },
  png: { kind: "image", mime: "image/png", families: ["png"] },
  gif: { kind: "image", mime: "image/gif", families: ["gif"] },
  webp: { kind: "image", mime: "image/webp", families: ["webp"] },
  bmp: { kind: "image", mime: "image/bmp", families: ["bmp"] },
  heic: { kind: "image", mime: "image/heic", families: ["heic"] },
  heif: { kind: "image", mime: "image/heif", families: ["heic"] },
  tif: { kind: "image", mime: "image/tiff", families: ["tiff"] },
  tiff: { kind: "image", mime: "image/tiff", families: ["tiff"] },

  pdf: { kind: "document", mime: "application/pdf", families: ["pdf"] },
  doc: { kind: "document", mime: "application/msword", families: ["ole"] },
  xls: { kind: "document", mime: "application/vnd.ms-excel", families: ["ole"] },
  ppt: { kind: "document", mime: "application/vnd.ms-powerpoint", families: ["ole"] },
  docx: { kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", families: ["zip"] },
  xlsx: { kind: "document", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", families: ["zip"] },
  pptx: { kind: "document", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", families: ["zip"] },
  odt: { kind: "document", mime: "application/vnd.oasis.opendocument.text", families: ["zip"] },
  ods: { kind: "document", mime: "application/vnd.oasis.opendocument.spreadsheet", families: ["zip"] },
  odp: { kind: "document", mime: "application/vnd.oasis.opendocument.presentation", families: ["zip"] },
  rtf: { kind: "document", mime: "application/rtf", families: ["rtf"] },
  txt: { kind: "document", mime: "text/plain", families: ["text"] },
  csv: { kind: "document", mime: "text/csv", families: ["text"] },
  md: { kind: "document", mime: "text/markdown", families: ["text"] },
  log: { kind: "document", mime: "text/plain", families: ["text"] },
  json: { kind: "document", mime: "application/json", families: ["text"] },
  xml: { kind: "document", mime: "application/xml", families: ["text"] },
  zip: { kind: "document", mime: "application/zip", families: ["zip"] },
  rar: { kind: "document", mime: "application/vnd.rar", families: ["rar"] },
  "7z": { kind: "document", mime: "application/x-7z-compressed", families: ["7z"] },
  gz: { kind: "document", mime: "application/gzip", families: ["gzip"] },

  mp4: { kind: "video", mime: "video/mp4", families: ["mp4"] },
  m4v: { kind: "video", mime: "video/mp4", families: ["mp4"] },
  mov: { kind: "video", mime: "video/quicktime", families: ["mp4"] },
  "3gp": { kind: "video", mime: "video/3gpp", families: ["mp4"] },
  webm: { kind: "video", mime: "video/webm", families: ["webm"] },
  mkv: { kind: "video", mime: "video/x-matroska", families: ["webm"] },
  avi: { kind: "video", mime: "video/x-msvideo", families: ["avi"] },

  mp3: { kind: "audio", mime: "audio/mpeg", families: ["mp3"] },
  ogg: { kind: "audio", mime: "audio/ogg", families: ["ogg"] },
  opus: { kind: "audio", mime: "audio/ogg", families: ["ogg"] },
  wav: { kind: "audio", mime: "audio/wav", families: ["wav"] },
  flac: { kind: "audio", mime: "audio/flac", families: ["flac"] },
  amr: { kind: "audio", mime: "audio/amr", families: ["amr"] },
  aac: { kind: "audio", mime: "audio/aac", families: ["aac"] },
  m4a: { kind: "audio", mime: "audio/mp4", families: ["mp4"] },
};

/** Extensões de programas e scripts: nunca são enviadas, qualquer que seja o conteúdo. */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe", "bat", "cmd", "com", "scr", "msi", "msp", "dll", "sys", "drv", "cpl", "pif", "gadget", "lnk", "reg", "hta",
  "js", "mjs", "cjs", "jse", "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "psd1", "sh", "bash", "zsh", "csh", "ksh", "command",
  "jar", "apk", "aab", "ipa", "app", "bin", "run", "appimage", "deb", "rpm", "dmg", "pkg", "iso", "vhd",
  "py", "pyc", "rb", "pl", "php", "html", "htm", "xhtml", "svg", "swf", "scf", "inf", "msc", "ws", "docm", "xlsm", "pptm",
]);

export type FileErrorCode = "EMPTY" | "TOO_LARGE" | "BLOCKED_TYPE" | "UNSUPPORTED_TYPE" | "CONTENT_MISMATCH" | "BAD_NAME";

export const FILE_ERROR_MESSAGES: Record<FileErrorCode, string> = {
  EMPTY: "O arquivo está vazio.",
  TOO_LARGE: "O arquivo passa do limite de 25 MB.",
  BLOCKED_TYPE: "Este tipo de arquivo (programa ou script) não pode ser enviado.",
  UNSUPPORTED_TYPE: "Este tipo de arquivo não é aceito. Envie imagem, vídeo, áudio, PDF, Office, texto, planilha ou arquivo compactado.",
  CONTENT_MISMATCH: "O conteúdo do arquivo não corresponde ao tipo indicado pelo nome. Ele não foi enviado.",
  BAD_NAME: "O nome do arquivo é inválido.",
};

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Nome seguro para guardar e mostrar: sem pastas, sem caracteres de controle, no máximo 120 caracteres. */
export function sanitizeFileName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (base.length <= 120) return base;
  const ext = extensionOf(base);
  const keep = 120 - (ext ? ext.length + 1 : 0);
  return `${base.slice(0, keep)}${ext ? `.${ext}` : ""}`;
}

const startsWith = (head: Uint8Array, bytes: number[], offset = 0): boolean =>
  head.length >= offset + bytes.length && bytes.every((value, index) => head[offset + index] === value);

const ascii = (head: Uint8Array, start: number, end: number): string => String.fromCharCode(...head.slice(start, end));

/** Reconhece o tipo pelos primeiros bytes. */
export function detectContentFamily(head: Uint8Array): ContentFamily {
  if (head.length === 0) return "unknown";
  // Programas e scripts, não importa a extensão.
  if (startsWith(head, [0x4d, 0x5a])) return "executable"; // MZ (exe, dll, scr)
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return "executable"; // ELF
  if (startsWith(head, [0xca, 0xfe, 0xba, 0xbe]) || startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(head, [0xfe, 0xed, 0xfa, 0xcf]) || startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(head, [0xce, 0xfa, 0xed, 0xfe])) return "executable"; // Mach-O / classe Java
  if (startsWith(head, [0x23, 0x21])) return "executable"; // #! (script com interpretador)

  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a") return "gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "webp";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WAVE") return "wav";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "AVI ") return "avi";
  if (ascii(head, 0, 2) === "BM" && head.length > 14) return "bmp";
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (ascii(head, 0, 5) === "%PDF-") return "pdf";
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  if (ascii(head, 0, 5) === "{\\rtf") return "rtf";
  if (ascii(head, 0, 7) === "Rar!\u001a\u0007\u0000" || ascii(head, 0, 8) === "Rar!\u001a\u0007\u0001\u0000") return "rar";
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (startsWith(head, [0x1f, 0x8b])) return "gzip";
  if (ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic";
    return "mp4";
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (ascii(head, 0, 4) === "OggS") return "ogg";
  if (ascii(head, 0, 4) === "fLaC") return "flac";
  if (ascii(head, 0, 5) === "#!AMR") return "amr";
  if (ascii(head, 0, 3) === "ID3") return "mp3";
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return (head[1] & 0x06) === 0 ? "aac" : "mp3";

  // Texto puro: sem byte nulo e (quase) só caracteres imprimíveis/UTF-8 válido.
  if (looksLikeText(head)) return "text";
  return "unknown";
}

function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  let offset = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) offset = 3; // BOM UTF-8
  const slice = head.slice(offset);
  if (slice.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(slice);
  } catch {
    // Um arquivo cortado no meio de um caractere UTF-8 ainda é texto; qualquer outra falha não é.
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(slice.slice(0, Math.max(0, slice.length - 3)));
    } catch {
      return false;
    }
  }
  return true;
}

export type FileValidation =
  | { ok: true; kind: MediaKind; mime: string; extension: string; family: ContentFamily; fileName: string }
  | { ok: false; code: FileErrorCode; message: string };

const fail = (code: FileErrorCode): FileValidation => ({ ok: false, code, message: FILE_ERROR_MESSAGES[code] });

/**
 * Decide se o arquivo pode ser enviado. `head` são os primeiros bytes (até HEAD_BYTES); sem eles só a extensão e o
 * tamanho são conferidos (aviso no navegador) e o resultado NÃO vale como decisão final.
 */
export function validateOutgoingFile(input: { fileName: string; size: number; head?: Uint8Array | null }): FileValidation {
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName) return fail("BAD_NAME");
  if (!Number.isFinite(input.size) || input.size <= 0) return fail("EMPTY");
  if (input.size > MAX_FILE_BYTES) return fail("TOO_LARGE");

  const extension = extensionOf(fileName);
  if (!extension) return fail("UNSUPPORTED_TYPE");
  if (BLOCKED_EXTENSIONS.has(extension)) return fail("BLOCKED_TYPE");
  const rule = ALLOWED[extension];
  if (!rule) return fail("UNSUPPORTED_TYPE");

  let family: ContentFamily = rule.families[0];
  if (input.head) {
    const detected = detectContentFamily(input.head);
    if (detected === "executable") return fail("BLOCKED_TYPE");
    if (!rule.families.includes(detected)) return fail("CONTENT_MISMATCH");
    family = detected;
  }
  return { ok: true, kind: rule.kind, mime: rule.mime, extension, family, fileName };
}

/** O que a Evolution recebe como `mediatype`: imagem "como documento" segue sem compressão. */
export function mediaTypeFor(kind: MediaKind, asDocument: boolean): MediaKind {
  return kind === "image" && asDocument ? "document" : kind;
}

/**
 * Texto da mensagem quando não há legenda (a conversa e a lista mostram isto). Segue EXATAMENTE o rótulo que o
 * recebimento do webhook grava para o eco da própria mensagem ("📷 Imagem", "🎬 Vídeo", "🎧 Áudio" e "📄 Documento: nome"):
 * assim o eco que a Evolution devolve é reconhecido como a mesma mensagem e não aparece em duplicidade.
 */
export function mediaLabel(kind: MediaKind, fileName: string): string {
  if (kind === "image") return "📷 Imagem";
  if (kind === "video") return "🎬 Vídeo";
  if (kind === "audio") return "🎧 Áudio";
  return `📄 Documento: ${fileName}`;
}

/** Tamanho legível ("1,2 MB"). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/** Valor do atributo `accept` do seletor de arquivos (o servidor revalida tudo; isto só guia a escolha). */
export const ACCEPT_ATTRIBUTE: string = Object.keys(ALLOWED)
  .map((extension) => `.${extension}`)
  .join(",");

/** Só estes tipos de imagem o navegador consegue mostrar como miniatura. */
export function canPreviewImage(extension: string): boolean {
  return ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(extension);
}
