import { expect, test } from "@playwright/test";
import { attachmentKindLabel, describeAttachment, formatAttachmentSize } from "@/lib/conversations/attachment-label";

test("classifica o tipo pelo mime", () => {
  expect(attachmentKindLabel("application/pdf")).toBe("PDF");
  expect(attachmentKindLabel("image/jpeg")).toBe("Imagem");
  expect(attachmentKindLabel("audio/ogg; codecs=opus")).toBe("Áudio");
  expect(attachmentKindLabel("video/mp4")).toBe("Vídeo");
  expect(attachmentKindLabel("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("Documento");
  expect(attachmentKindLabel("application/octet-stream")).toBe("Documento");
});

test("formata tamanho e omite quando desconhecido (0)", () => {
  expect(formatAttachmentSize(0)).toBeNull();
  expect(formatAttachmentSize(-1)).toBeNull();
  expect(formatAttachmentSize(900)).toBe("900 B");
  expect(formatAttachmentSize(120_000)).toBe("117 KB");
  expect(formatAttachmentSize(2_621_440)).toBe("2,5 MB");
});

test("chip de anexo indisponível orienta a abrir no WhatsApp", () => {
  const unavailable = describeAttachment({ file_name: "holerite.pdf", mime_type: "application/pdf", size_bytes: 120_000, status: "unavailable" });
  expect(unavailable.title).toBe("PDF · holerite.pdf · 117 KB");
  expect(unavailable.hint).toContain("abra no WhatsApp");

  const unknownSize = describeAttachment({ file_name: "imagem", mime_type: "image/jpeg", size_bytes: 0, status: "pending" });
  expect(unknownSize.title).toBe("Imagem · imagem");

  expect(describeAttachment({ file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10, status: "available" }).hint).toBeNull();
});
