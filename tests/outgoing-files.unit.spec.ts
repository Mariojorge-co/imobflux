import { expect, test } from "@playwright/test";
import {
  BLOCKED_EXTENSIONS,
  detectContentFamily,
  extensionOf,
  formatFileSize,
  HEAD_BYTES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  mediaLabel,
  mediaTypeFor,
  sanitizeFileName,
  validateOutgoingFile,
} from "../lib/conversations/outgoing-files";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const pad = (head: Uint8Array, length = 64) => {
  const out = new Uint8Array(length);
  out.set(head);
  return out;
};

const JPEG = pad(bytes(0xff, 0xd8, 0xff, 0xe0));
const PNG = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const PDF = pad(text("%PDF-1.7\n"));
const ZIP = pad(bytes(0x50, 0x4b, 0x03, 0x04));
const OLE = pad(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1));
const RAR = pad(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00));
const MP4 = pad(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d));
const EXE = pad(bytes(0x4d, 0x5a, 0x90, 0x00));
const ELF = pad(bytes(0x7f, 0x45, 0x4c, 0x46));
const SHEBANG = pad(text("#!/bin/sh\nrm -rf /\n"));

test.describe("arquivos enviados: limites e tipos", () => {
  test("limites: 25 MB por arquivo e 10 por vez", () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_FILES_PER_BATCH).toBe(10);
    expect(HEAD_BYTES).toBeGreaterThanOrEqual(512);
  });

  test("tamanho: 24 MB passa, exatamente 25 MB passa, 26 MB e vazio são recusados", () => {
    expect(validateOutgoingFile({ fileName: "a.pdf", size: 24 * 1024 * 1024, head: PDF }).ok).toBe(true);
    expect(validateOutgoingFile({ fileName: "a.pdf", size: MAX_FILE_BYTES, head: PDF }).ok).toBe(true);
    const big = validateOutgoingFile({ fileName: "a.pdf", size: 26 * 1024 * 1024, head: PDF });
    expect(big).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(big.ok ? "" : big.message).toMatch(/25 MB/);
    expect(validateOutgoingFile({ fileName: "a.pdf", size: 0, head: PDF })).toMatchObject({ ok: false, code: "EMPTY" });
  });

  test("aceita os tipos pedidos: imagem, PDF, Office, texto, planilha, compactados, vídeo e áudio", () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ["foto.jpg", JPEG, "image"],
      ["foto.JPEG", JPEG, "image"],
      ["print.png", PNG, "image"],
      ["contrato.pdf", PDF, "document"],
      ["proposta.docx", ZIP, "document"],
      ["tabela.xlsx", ZIP, "document"],
      ["slides.pptx", ZIP, "document"],
      ["antigo.doc", OLE, "document"],
      ["antigo.xls", OLE, "document"],
      ["notas.txt", text("Olá, tudo bem?\nSegue o valor."), "document"],
      ["lista.csv", text("nome;valor\nAna;10\n"), "document"],
      ["pacote.zip", ZIP, "document"],
      ["pacote.rar", RAR, "document"],
      ["visita.mp4", MP4, "video"],
      ["visita.mov", MP4, "video"],
      ["audio.m4a", MP4, "audio"],
      ["audio.mp3", pad(text("ID3\u0003")), "audio"],
      ["audio.ogg", pad(text("OggS")), "audio"],
    ];
    for (const [name, head, kind] of cases) {
      const result = validateOutgoingFile({ fileName: name, size: 2048, head });
      expect(result.ok, name).toBe(true);
      if (result.ok) expect(result.kind, name).toBe(kind);
    }
  });

  test("BLOQUEIA executáveis e scripts pela extensão (mesmo com conteúdo inofensivo)", () => {
    for (const ext of ["exe", "bat", "cmd", "com", "scr", "msi", "js", "vbs", "ps1", "sh", "jar", "apk", "dll", "lnk", "html", "svg", "docm"]) {
      expect(BLOCKED_EXTENSIONS.has(ext), ext).toBe(true);
      expect(validateOutgoingFile({ fileName: `arquivo.${ext}`, size: 100, head: PDF }), ext).toMatchObject({ ok: false, code: "BLOCKED_TYPE" });
    }
    // dupla extensão: vale a última
    expect(validateOutgoingFile({ fileName: "fatura.pdf.exe", size: 100, head: PDF })).toMatchObject({ ok: false, code: "BLOCKED_TYPE" });
    expect(validateOutgoingFile({ fileName: "SCRIPT.PS1", size: 100 })).toMatchObject({ ok: false, code: "BLOCKED_TYPE" });
  });

  test("BLOQUEIA executável disfarçado: conteúdo de programa com extensão de foto, PDF ou texto", () => {
    expect(validateOutgoingFile({ fileName: "foto.jpg", size: 100, head: EXE })).toMatchObject({ ok: false, code: "BLOCKED_TYPE" });
    expect(validateOutgoingFile({ fileName: "contrato.pdf", size: 100, head: ELF })).toMatchObject({ ok: false, code: "BLOCKED_TYPE" });
    expect(validateOutgoingFile({ fileName: "notas.txt", size: 100, head: SHEBANG })).toMatchObject({ ok: false, code: "BLOCKED_TYPE" });
  });

  test("tipo por conteúdo: extensão diferente do conteúdo é recusada", () => {
    expect(validateOutgoingFile({ fileName: "foto.png", size: 100, head: JPEG })).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(validateOutgoingFile({ fileName: "contrato.pdf", size: 100, head: PNG })).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(validateOutgoingFile({ fileName: "planilha.xlsx", size: 100, head: PDF })).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(validateOutgoingFile({ fileName: "notas.txt", size: 100, head: PNG })).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(validateOutgoingFile({ fileName: "video.mp4", size: 100, head: pad(text("abc")) })).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
  });

  test("extensão desconhecida ou ausente não é aceita", () => {
    expect(validateOutgoingFile({ fileName: "arquivo.xyz", size: 100, head: PDF })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(validateOutgoingFile({ fileName: "semextensao", size: 100, head: PDF })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(validateOutgoingFile({ fileName: ".pdf", size: 100, head: PDF })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
  });

  test("o mime enviado vem da extensão validada, nunca do que o navegador disse", () => {
    const result = validateOutgoingFile({ fileName: "foto.jpg", size: 100, head: JPEG });
    expect(result.ok && result.mime).toBe("image/jpeg");
    const docx = validateOutgoingFile({ fileName: "a.docx", size: 100, head: ZIP });
    expect(docx.ok && docx.mime).toContain("wordprocessingml");
  });

  test("detecção por bytes mágicos", () => {
    expect(detectContentFamily(JPEG)).toBe("jpeg");
    expect(detectContentFamily(PNG)).toBe("png");
    expect(detectContentFamily(PDF)).toBe("pdf");
    expect(detectContentFamily(ZIP)).toBe("zip");
    expect(detectContentFamily(RAR)).toBe("rar");
    expect(detectContentFamily(pad(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)))).toBe("7z");
    expect(detectContentFamily(MP4)).toBe("mp4");
    expect(detectContentFamily(EXE)).toBe("executable");
    expect(detectContentFamily(new Uint8Array(0))).toBe("unknown");
    expect(detectContentFamily(pad(bytes(0xff, 0x00, 0x01, 0x02, 0x00, 0x00)))).toBe("unknown");
  });

  test("nome: sem pastas nem caracteres de controle; extensão preservada ao encurtar", () => {
    expect(sanitizeFileName("C:\\Users\\Ana\\Documentos\\contrato final.pdf")).toBe("contrato final.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a\u0000b\nc.pdf")).toBe("abc.pdf");
    const long = sanitizeFileName(`${"x".repeat(300)}.pdf`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith(".pdf")).toBe(true);
    expect(extensionOf("a.b.C.PDF")).toBe("pdf");
    expect(extensionOf(".bashrc")).toBe("");
  });

  test("imagem 'como documento' segue como documento; rótulo e tamanho legíveis", () => {
    expect(mediaTypeFor("image", true)).toBe("document");
    expect(mediaTypeFor("image", false)).toBe("image");
    expect(mediaTypeFor("video", true)).toBe("video");
    // Os rótulos são os mesmos que o webhook grava para o eco da própria mensagem (para o eco não duplicar).
    expect(mediaLabel("document", "a.pdf")).toBe("📄 Documento: a.pdf");
    expect(mediaLabel("image", "foto.png")).toBe("📷 Imagem");
    expect(mediaLabel("video", "v.mp4")).toBe("🎬 Vídeo");
    expect(mediaLabel("audio", "a.mp3")).toBe("🎧 Áudio");
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1536)).toBe("1,5 KB");
    expect(formatFileSize(24 * 1024 * 1024)).toBe("24,0 MB");
  });
});

test("seletor de arquivos: no celular oferece câmera/galeria (image/*, video/*, audio/*) e documentos por extensão", async () => {
  const { ACCEPT_ATTRIBUTE } = await import("../lib/conversations/outgoing-files");
  const parts = ACCEPT_ATTRIBUTE.split(",");
  expect(parts.slice(0, 3)).toEqual(["image/*", "video/*", "audio/*"]);
  expect(parts).toContain(".pdf");
  expect(parts).toContain(".docx");
  expect(parts).toContain(".rar");
  expect(parts).not.toContain(".exe");
});
