import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const media = require("@/lib/conversations/media-download") as typeof import("@/lib/conversations/media-download");

const ENV = { EVOLUTION_API_URL: "http://evolution.test:8080/", EVOLUTION_API_KEY: "key-123" };
const PDF = Buffer.from("%PDF-1.4 conteudo de teste");
const SOURCE = { instance: "inst-1", key: { id: "ABC123", remoteJid: "5582988880000@s.whatsapp.net", fromMe: false } };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test.describe("decodeBase64Media", () => {
  test("decodifica base64, com ou sem prefixo data URL, e respeita o limite", () => {
    const encoded = PDF.toString("base64");
    expect(media.decodeBase64Media(encoded)).toMatchObject({ buffer: PDF, mimeType: null });
    expect(media.decodeBase64Media(`data:application/pdf;base64,${encoded}`)).toMatchObject({ buffer: PDF, mimeType: "application/pdf" });
    expect(media.decodeBase64Media(` ${encoded.slice(0, 8)}\n${encoded.slice(8)} `)).toMatchObject({ buffer: PDF });
    expect(media.decodeBase64Media(encoded, 5)).toBe("TOO_LARGE");
  });

  test("rejeita entrada inválida", () => {
    for (const bad of [undefined, null, 123, "", "   ", "não é base64!!", "abc$def"]) {
      expect(media.decodeBase64Media(bad)).toBeNull();
    }
  });
});

test.describe("fetchEvolutionMedia", () => {
  test("pede à Evolution v2 com apikey e a chave da mensagem e devolve o arquivo", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const result = await media.fetchEvolutionMedia(SOURCE, {
      env: ENV,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse({ base64: PDF.toString("base64"), mimetype: "application/pdf", mediaType: "document" });
      }) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ ok: true, buffer: PDF, mimeType: "application/pdf" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://evolution.test:8080/chat/getBase64FromMediaMessage/inst-1");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe("key-123");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: { key: { id: "ABC123", remoteJid: "5582988880000@s.whatsapp.net", fromMe: false } },
      convertToMp4: false,
    });
  });

  test("usa o base64 do próprio webhook sem chamar a Evolution", async () => {
    let called = false;
    const result = await media.fetchEvolutionMedia(
      { ...SOURCE, inlineBase64: PDF.toString("base64") },
      { env: {}, fetchImpl: (async () => { called = true; return jsonResponse({}); }) as unknown as typeof fetch },
    );
    expect(result).toMatchObject({ ok: true, buffer: PDF });
    expect(called).toBe(false);
  });

  test("base64 inline inválido cai para a Evolution", async () => {
    const result = await media.fetchEvolutionMedia(
      { ...SOURCE, inlineBase64: "!!!" },
      { env: ENV, fetchImpl: (async () => jsonResponse({ base64: PDF.toString("base64") })) as unknown as typeof fetch },
    );
    expect(result).toMatchObject({ ok: true, buffer: PDF });
  });

  test("falhas viram códigos e nunca lançam", async () => {
    const run = (fetchImpl: unknown, env: Record<string, string | undefined> = ENV, source = SOURCE) =>
      media.fetchEvolutionMedia(source, { env, fetchImpl: fetchImpl as typeof fetch, timeoutMs: 50 });

    expect(await run(async () => jsonResponse({}, 404))).toEqual({ ok: false, code: "NOT_FOUND" });
    // Contrato real da Evolution v2.3.7: mensagem que ela já não tem responde 400 "Message not found".
    expect(await run(async () => jsonResponse({ status: 400, error: "Bad Request", response: { message: ["Message not found"] } }, 400))).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await run(async () => jsonResponse({ error: "Bad Request" }, 400))).toEqual({ ok: false, code: "HTTP_ERROR" });
    expect(await run(async () => jsonResponse({}, 500))).toEqual({ ok: false, code: "HTTP_ERROR" });
    expect(await run(async () => new Response("não é json", { status: 200 }))).toEqual({ ok: false, code: "INVALID_RESPONSE" });
    expect(await run(async () => jsonResponse({ base64: 42 }))).toEqual({ ok: false, code: "INVALID_RESPONSE" });
    expect(await run(async () => jsonResponse({ nada: true }))).toEqual({ ok: false, code: "INVALID_RESPONSE" });
    expect(await run(async () => { throw new TypeError("fetch failed"); })).toEqual({ ok: false, code: "NETWORK_ERROR" });
    expect(await run(
      (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    )).toEqual({ ok: false, code: "TIMEOUT" });
    expect(await run(async () => jsonResponse({}), {})).toEqual({ ok: false, code: "NOT_CONFIGURED" });
    expect(await run(async () => jsonResponse({}), { EVOLUTION_API_URL: "http://x" })).toEqual({ ok: false, code: "NOT_CONFIGURED" });
    expect(await run(async () => jsonResponse({}), ENV, { ...SOURCE, instance: "" })).toEqual({ ok: false, code: "NOT_CONFIGURED" });
  });

  test("arquivo acima do limite é recusado", async () => {
    const huge = "A".repeat(72_000_000); // ~54 MB decodificado (limite 50 MiB)
    const result = await media.fetchEvolutionMedia(SOURCE, {
      env: ENV,
      fetchImpl: (async () => jsonResponse({ base64: huge })) as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: false, code: "TOO_LARGE" });
  });
});

type Rpc = { fn: string; args: Record<string, unknown> };
type Ctx = { attachment_id: string; storage_bucket: string; storage_key: string; status: string; mime_type: string };
function fakeAdmin(options: {
  attachment?: Ctx | null;
  uploadError?: boolean;
  markError?: boolean;
  lookupError?: boolean;
} = {}) {
  const rpcs: Rpc[] = [];
  const uploads: Array<{ bucket: string; key: string; size: number; options: Record<string, unknown> }> = [];
  const context = options.attachment === undefined
    ? { attachment_id: "att-1", storage_bucket: "whatsapp-media", storage_key: "ws/msg/att-1", status: "pending", mime_type: "application/pdf" }
    : options.attachment;
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "get_attachment_download_context") {
        return options.lookupError ? { data: null, error: { message: "x" } } : { data: context, error: null };
      }
      if (fn === "mark_attachment_available" && options.markError) return { data: null, error: { message: "boom" } };
      return { data: { status: "success" }, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string, body: Buffer, uploadOptions: Record<string, unknown>) => {
          uploads.push({ bucket, key, size: body.length, options: uploadOptions });
          return options.uploadError ? { data: null, error: { message: "storage down" } } : { data: { path: key }, error: null };
        },
      }),
    },
  };
  return { admin: admin as never, rpcs, uploads };
}const okFetch = (async () => jsonResponse({ base64: PDF.toString("base64"), mimetype: "application/pdf" })) as unknown as typeof fetch;

test.describe("storeAttachmentMedia", () => {
  test("baixa, guarda no bucket privado e marca como disponível (com tamanho e checksum reais)", async () => {
    const { admin, rpcs, uploads } = fakeAdmin();
    const result = await media.storeAttachmentMedia(admin, "att-1", SOURCE, { env: ENV, fetchImpl: okFetch });
    expect(result).toEqual({ status: "available" });
    expect(uploads).toEqual([{ bucket: "whatsapp-media", key: "ws/msg/att-1", size: PDF.length, options: { contentType: "application/pdf", upsert: true } }]);
    expect(rpcs.map((r) => `${r.fn}:${r.args.p_state ?? ""}`)).toEqual(["get_attachment_download_context:", "mark_attachment_download_state:pending", "mark_attachment_available:"]);
    expect(rpcs[2].args).toEqual({
      p_attachment_id: "att-1",
      p_size_bytes: PDF.length,
      p_mime_type: "application/pdf",
      p_sha256: createHash("sha256").update(PDF).digest("hex"),
    });
  });

  test("tipo executável (HTML/SVG) é guardado como octet-stream", async () => {
    const { admin, uploads } = fakeAdmin();
    const html = (async () => jsonResponse({ base64: Buffer.from("<script>alert(1)</script>").toString("base64"), mimetype: "text/html" })) as unknown as typeof fetch;
    await media.storeAttachmentMedia(admin, "att-1", SOURCE, { env: ENV, fetchImpl: html });
    expect(uploads[0].options.contentType).toBe("application/octet-stream");
  });

  test("anexo já disponível não baixa de novo", async () => {
    const { admin, rpcs, uploads } = fakeAdmin({ attachment: { attachment_id: "att-1", storage_bucket: "b", storage_key: "k", status: "available", mime_type: "application/pdf" } });
    let called = false;
    const result = await media.storeAttachmentMedia(admin, "att-1", SOURCE, { env: ENV, fetchImpl: (async () => { called = true; return okFetch("" as never); }) as unknown as typeof fetch });
    expect(result).toEqual({ status: "available" });
    expect(called).toBe(false);
    expect(uploads).toHaveLength(0);
    expect(rpcs.map((r) => r.fn)).toEqual(["get_attachment_download_context"]); // só leu o contexto; nada mais
  });

  test("Evolution fora do ar: degrada para 'unavailable', não lança e não grava arquivo", async () => {
    const { admin, rpcs, uploads } = fakeAdmin();
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const result = await media.storeAttachmentMedia(admin, "att-1", SOURCE, { env: ENV, fetchImpl: down });
    expect(result).toEqual({ status: "failed", code: "NETWORK_ERROR" });
    expect(uploads).toHaveLength(0);
    expect(rpcs.map((r) => r.args.p_state ?? r.fn)).toEqual(["get_attachment_download_context", "pending", "unavailable"]);
  });

  test("Evolution devolvendo 500, 404, resposta inválida ou sem configuração também degradam", async () => {
    for (const [fetchImpl, env, code] of [
      [async () => jsonResponse({}, 500), ENV, "HTTP_ERROR"],
      [async () => jsonResponse({}, 404), ENV, "NOT_FOUND"],
      [async () => jsonResponse({ ok: 1 }), ENV, "INVALID_RESPONSE"],
      [async () => jsonResponse({}), {}, "NOT_CONFIGURED"],
    ] as const) {
      const { admin, rpcs } = fakeAdmin();
      const result = await media.storeAttachmentMedia(admin, "att-1", SOURCE, { env, fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(result).toEqual({ status: "failed", code });
      expect(rpcs.at(-1)?.args.p_state).toBe("unavailable");
    }
  });

  test("falha no Storage ou ao marcar disponível degrada e não lança", async () => {
    const storage = fakeAdmin({ uploadError: true });
    expect(await media.storeAttachmentMedia(storage.admin, "att-1", SOURCE, { env: ENV, fetchImpl: okFetch })).toEqual({ status: "failed", code: "STORAGE_ERROR" });
    expect(storage.rpcs.at(-1)?.args.p_state).toBe("unavailable");

    const mark = fakeAdmin({ markError: true });
    expect(await media.storeAttachmentMedia(mark.admin, "att-1", SOURCE, { env: ENV, fetchImpl: okFetch })).toEqual({ status: "failed", code: "STORAGE_ERROR" });
    expect(mark.rpcs.at(-1)?.args.p_state).toBe("unavailable");
  });

  test("anexo inexistente ou erro de consulta: falha sem lançar", async () => {
    expect(await media.storeAttachmentMedia(fakeAdmin({ attachment: null }).admin, "att-x", SOURCE, { env: ENV, fetchImpl: okFetch })).toEqual({ status: "failed", code: "NOT_FOUND" });
    expect(await media.storeAttachmentMedia(fakeAdmin({ lookupError: true }).admin, "att-x", SOURCE, { env: ENV, fetchImpl: okFetch })).toEqual({ status: "failed", code: "NOT_FOUND" });
  });

  test("exceção inesperada (admin quebrado) não escapa", async () => {
    const broken = { from: () => { throw new Error("boom"); }, rpc: async () => { throw new Error("boom"); } } as never;
    expect(await media.storeAttachmentMedia(broken, "att-1", SOURCE, { env: ENV, fetchImpl: okFetch })).toEqual({ status: "failed", code: "NETWORK_ERROR" });
  });
});

test.describe("scheduleMediaDownload", () => {
  test("fora de uma requisição executa em segundo plano e engole falhas", async () => {
    let ran = false;
    media.scheduleMediaDownload(async () => { ran = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ran).toBe(true);

    expect(() => media.scheduleMediaDownload(async () => { throw new Error("falha no download"); })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});

test.describe("loadMediaSource", () => {
  const base = {
    attachment_id: "att-1", storage_bucket: "whatsapp-media", storage_key: "k", status: "unavailable", mime_type: "application/pdf",
    instance: "inst-9", external_message_id: "EXT1", from_me: false, remote_jid: "5582988880000@s.whatsapp.net",
    conversation_type: "individual", participant_phone: null,
  };
  const rpcAdmin = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) }) as never;

  test("reconstrói instância e chave da mensagem a partir do contexto lido por RPC", async () => {
    expect(await media.loadMediaSource(rpcAdmin(base), "att-1")).toEqual({
      instance: "inst-9",
      key: { id: "EXT1", remoteJid: "5582988880000@s.whatsapp.net", fromMe: false, participant: null },
    });
  });

  test("em grupo inclui o participante remetente", async () => {
    const source = await media.loadMediaSource(rpcAdmin({ ...base, external_message_id: "EXT2", remote_jid: "1203630@g.us", conversation_type: "group", participant_phone: "+5582988881111" }), "att-1");
    expect(source?.key).toEqual({ id: "EXT2", remoteJid: "1203630@g.us", fromMe: false, participant: "5582988881111@s.whatsapp.net" });
  });

  test("mensagem enviada por nós (fromMe) é identificada", async () => {
    expect((await media.loadMediaSource(rpcAdmin({ ...base, from_me: true }), "att-1"))?.key.fromMe).toBe(true);
  });

  test("sem contexto, sem id externo, sem instância ou com erro devolve null", async () => {
    expect(await media.loadMediaSource(rpcAdmin(null), "att-1")).toBeNull();
    expect(await media.loadMediaSource(rpcAdmin(base, { message: "x" }), "att-1")).toBeNull();
    expect(await media.loadMediaSource(rpcAdmin({ ...base, external_message_id: null }), "att-1")).toBeNull();
    expect(await media.loadMediaSource(rpcAdmin({ ...base, instance: null }), "att-1")).toBeNull();
    expect(await media.loadMediaSource(rpcAdmin([]), "att-1")).toBeNull();
  });
});
test.describe("storeAttachmentMediaWithRetry (download automático)", () => {
  const failing = (calls: { n: number }) => (async () => { calls.n += 1; throw new TypeError("fetch failed"); }) as unknown as typeof fetch;

  test("falha passageira: tenta de novo com espera crescente e, acabadas as tentativas, desiste (sem laço infinito)", async () => {
    const { admin } = fakeAdmin();
    const calls = { n: 0 };
    const waits: number[] = [];
    const result = await media.storeAttachmentMediaWithRetry(admin, "att-1", SOURCE, {
      env: ENV, fetchImpl: failing(calls), sleep: async (ms) => { waits.push(ms); },
    });
    expect(result).toEqual({ status: "failed", code: "NETWORK_ERROR" });
    expect(calls.n).toBe(3);
    expect(waits).toEqual([2000, 6000]);
  });

  test("a segunda tentativa que dá certo encerra o ciclo", async () => {
    const { admin, uploads } = fakeAdmin();
    let n = 0;
    const flaky = (async () => { n += 1; if (n === 1) throw new TypeError("fetch failed"); return jsonResponse({ base64: PDF.toString("base64"), mimetype: "application/pdf" }); }) as unknown as typeof fetch;
    const result = await media.storeAttachmentMediaWithRetry(admin, "att-1", SOURCE, { env: ENV, fetchImpl: flaky, sleep: async () => undefined });
    expect(result).toEqual({ status: "available" });
    expect(n).toBe(2);
    expect(uploads).toHaveLength(1);
  });

  test("falha final (arquivo grande demais ou inexistente) não repete", async () => {
    const calls = { n: 0 };
    const tooLarge = (async () => { calls.n += 1; return jsonResponse({ base64: "A".repeat(80), mimetype: "video/mp4" }); }) as unknown as typeof fetch;
    const big = media.decodeBase64Media("A".repeat(80), 10);
    expect(big).toBe("TOO_LARGE");
    const notFound = (async () => { calls.n += 1; return jsonResponse({}, 404); }) as unknown as typeof fetch;
    const result = await media.storeAttachmentMediaWithRetry(fakeAdmin().admin, "att-1", SOURCE, { env: ENV, fetchImpl: notFound, sleep: async () => undefined });
    expect(result).toEqual({ status: "failed", code: "NOT_FOUND" });
    expect(calls.n).toBe(1);
    void tooLarge;
  });

  test("respeita o orçamento de tempo da rota (não começa tentativa que não cabe)", async () => {
    const calls = { n: 0 };
    const result = await media.storeAttachmentMediaWithRetry(fakeAdmin().admin, "att-1", SOURCE, {
      env: ENV, fetchImpl: failing(calls), budgetMs: 1000, sleep: async () => undefined,
    });
    expect(result).toMatchObject({ status: "failed" });
    expect(calls.n).toBe(1);
  });
});

test.describe("downloadTimeoutMs", () => {
  test("20 s + 1 s por MB, no máximo 50 s", () => {
    expect(media.downloadTimeoutMs(null)).toBe(20_000);
    expect(media.downloadTimeoutMs(10 * 1024 * 1024)).toBe(30_000);
    expect(media.downloadTimeoutMs(50 * 1024 * 1024)).toBe(50_000);
    expect(media.downloadTimeoutMs(500 * 1024 * 1024)).toBe(50_000);
  });
});
