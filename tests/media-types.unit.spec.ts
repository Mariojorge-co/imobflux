import { expect, test } from "@playwright/test";
import { isDownloadInProgress, PENDING_STALE_AFTER_MS, safeContentType, viewerKindForMime } from "@/lib/conversations/media-types";

test("define o visualizador pelo tipo; SVG e tipos desconhecidos nunca são exibidos inline", () => {
  expect(viewerKindForMime("application/pdf")).toBe("pdf");
  expect(viewerKindForMime("image/jpeg")).toBe("image");
  expect(viewerKindForMime("image/webp")).toBe("image");
  expect(viewerKindForMime("audio/ogg; codecs=opus")).toBe("audio");
  expect(viewerKindForMime("video/mp4")).toBe("video");
  expect(viewerKindForMime("image/svg+xml")).toBe("file");
  expect(viewerKindForMime("text/html")).toBe("file");
  expect(viewerKindForMime("application/vnd.ms-excel")).toBe("file");
  expect(viewerKindForMime(null)).toBe("file");
});

test("arquivo de cliente que o navegador executaria vira octet-stream", () => {
  for (const unsafe of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml", "application/javascript", "text/javascript"]) {
    expect(safeContentType(unsafe)).toBe("application/octet-stream");
  }
  for (const invalid of ["", null, undefined, "nao-e-mime", "a/b/c", "image/png\r\nX-Evil: 1"]) {
    expect(safeContentType(invalid)).toBe("application/octet-stream");
  }
  expect(safeContentType("application/pdf")).toBe("application/pdf");
  expect(safeContentType("image/jpeg")).toBe("image/jpeg");
  expect(safeContentType("audio/ogg; codecs=opus")).toBe("audio/ogg; codecs=opus");
});

test("download em andamento: só 'pending' recente; depois de 5 min passa a oferecer nova tentativa", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const recent = new Date(now - 60_000).toISOString();
  const stale = new Date(now - PENDING_STALE_AFTER_MS - 1).toISOString();
  expect(isDownloadInProgress({ status: "pending", created_at: recent }, now)).toBe(true);
  expect(isDownloadInProgress({ status: "pending", created_at: stale }, now)).toBe(false);
  expect(isDownloadInProgress({ status: "pending" }, now)).toBe(true);
  expect(isDownloadInProgress({ status: "unavailable", created_at: recent }, now)).toBe(false);
  expect(isDownloadInProgress({ status: "available", created_at: recent }, now)).toBe(false);
});
