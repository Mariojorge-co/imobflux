try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} } as never;
} catch {
  // ignorar
}

import { expect, test } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-require-imports */
const serverModule = require("@/lib/supabase/server");
const adminModule = require("@/lib/supabase/admin");
const { GET } = require("@/app/api/attachments/[attachmentId]/route") as typeof import("@/app/api/attachments/[attachmentId]/route");
/* eslint-enable @typescript-eslint/no-require-imports */

const originalServer = serverModule.createServerSupabaseClient;
const originalAdmin = adminModule.createAdminSupabaseClient;
const originalFetch = globalThis.fetch;

const ID = "d3b0b8a2-6f5e-4c1a-9e57-0c1f2a9b7e11";
type Row = { id: string; storage_bucket: string; storage_key: string; status: string; mime_type: string; original_file_name: string } | null;

let user: { id: string } | null;
let row: Row;
let signResult: { data: { signedUrl: string } | null; error: unknown };
let upstream: (url: string, init?: RequestInit) => Promise<Response>;
let upstreamCalls: Array<{ url: string; range: string | null }>;
let queriedWith: Record<string, string>;

const available: NonNullable<Row> = {
  id: ID, storage_bucket: "whatsapp-media", storage_key: "ws/msg/att", status: "available",
  mime_type: "application/pdf", original_file_name: "holerite.pdf",
};

test.beforeEach(() => {
  user = { id: "u1" };
  row = { ...available };
  signResult = { data: { signedUrl: "http://storage.test/signed?token=abc" }, error: null };
  upstreamCalls = [];
  queriedWith = {};
  upstream = async () => new Response("%PDF-1.4 conteudo", { status: 200, headers: { "content-length": "17" } });
  serverModule.createServerSupabaseClient = async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: (column: string, value: string) => { queriedWith[column] = value; return { maybeSingle: async () => ({ data: row, error: null }) }; } }) }),
  });
  adminModule.createAdminSupabaseClient = () => ({
    storage: { from: (bucket: string) => ({ createSignedUrl: async (key: string) => { queriedWith.bucket = bucket; queriedWith.key = key; return signResult; } }) },
  });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    upstreamCalls.push({ url, range: new Headers(init?.headers).get("range") });
    return upstream(url, init);
  }) as typeof fetch;
});

test.afterEach(() => {
  serverModule.createServerSupabaseClient = originalServer;
  adminModule.createAdminSupabaseClient = originalAdmin;
  globalThis.fetch = originalFetch;
});

const call = (headers: Record<string, string> = {}, id = ID) =>
  GET(new Request(`http://app.test/api/attachments/${id}`, { headers }), { params: Promise.resolve({ attachmentId: id }) });

test("identificador inválido → 404 sem consultar nada", async () => {
  expect((await call({}, "nao-e-uuid")).status).toBe(404);
  expect(Object.keys(queriedWith)).toHaveLength(0);
});

test("sem sessão → 401 e nunca assina URL", async () => {
  user = null;
  expect((await call()).status).toBe(401);
  expect(upstreamCalls).toHaveLength(0);
});

test("anexo que a RLS esconde (contato protegido, grupo não liberado, antes do corte) → 404", async () => {
  row = null;
  const res = await call();
  expect(res.status).toBe(404);
  expect(upstreamCalls).toHaveLength(0);
  expect(queriedWith.bucket).toBeUndefined(); // nem chega a assinar
});

test("anexo ainda não disponível → 409 (a tela mostra o aviso)", async () => {
  for (const status of ["pending", "unavailable", "archived"]) {
    row = { ...available, status };
    expect((await call()).status).toBe(409);
  }
  expect(upstreamCalls).toHaveLength(0);
});

test("PDF disponível é entregue inline pela própria origem, com cabeçalhos seguros", async () => {
  const res = await call();
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("%PDF-1.4 conteudo");
  expect(res.headers.get("content-type")).toBe("application/pdf");
  expect(res.headers.get("content-disposition")).toContain("inline;");
  expect(res.headers.get("content-disposition")).toContain('filename="holerite.pdf"');
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("accept-ranges")).toBe("bytes");
  expect(res.headers.get("cache-control")).toBe("private, no-store"); // acesso revogado nunca é servido do cache
  expect(res.headers.get("content-security-policy")).toBeNull(); // PDF precisa do visualizador do navegador
  expect(queriedWith).toMatchObject({ id: ID, bucket: "whatsapp-media", key: "ws/msg/att" });
  expect(upstreamCalls[0].url).toBe("http://storage.test/signed?token=abc");
});

test("a URL assinada nunca aparece na resposta (nada de redirect nem vazamento)", async () => {
  const res = await call();
  expect(res.status).not.toBe(302);
  expect(res.headers.get("location")).toBeNull();
  expect([...res.headers.values()].join("|")).not.toContain("token=abc");
});

test("suporta Range (player de áudio): repassa o pedido e devolve 206 com Content-Range", async () => {
  row = { ...available, mime_type: "audio/ogg; codecs=opus", original_file_name: "voz.ogg" };
  upstream = async () => new Response("abc", { status: 206, headers: { "content-range": "bytes 0-2/10", "content-length": "3" } });
  const res = await call({ range: "bytes=0-2" });
  expect(upstreamCalls[0].range).toBe("bytes=0-2");
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toBe("bytes 0-2/10");
  expect(res.headers.get("content-type")).toBe("audio/ogg; codecs=opus");
  expect(res.headers.get("content-disposition")).toContain("inline;");
});

test("Range inválido (416) é repassado", async () => {
  upstream = async () => new Response(null, { status: 416 });
  expect((await call({ range: "bytes=999-" })).status).toBe(416);
});

test("tipo que o navegador executaria (HTML/SVG) é entregue como download isolado, nunca renderizado", async () => {
  for (const mime of ["text/html", "image/svg+xml", "application/xhtml+xml"]) {
    row = { ...available, mime_type: mime, original_file_name: "malicioso.html" };
    const res = await call();
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  }
});

test("nome de arquivo com aspas, quebra de linha e acentos não injeta cabeçalhos", async () => {
  row = { ...available, original_file_name: 'relatório "final"\r\nX-Evil: 1/../x.pdf' };
  const res = await call();
  const disposition = res.headers.get("content-disposition") ?? "";
  expect(disposition).not.toMatch(/[\r\n]/);
  expect(res.headers.get("x-evil")).toBeNull();
  expect(disposition).toContain("filename*=UTF-8''");
  expect(disposition).not.toContain('"final"');
});

test("falha ao assinar, storage indisponível ou resposta inesperada → 502 sem detalhes", async () => {
  signResult = { data: null, error: { message: "segredo interno" } };
  const noSign = await call();
  expect(noSign.status).toBe(502);
  expect(await noSign.text()).toBe("");

  signResult = { data: { signedUrl: "http://storage.test/signed" }, error: null };
  upstream = async () => { throw new TypeError("fetch failed"); };
  expect((await call()).status).toBe(502);

  upstream = async () => new Response("erro", { status: 500 });
  expect((await call()).status).toBe(502);

  upstream = async () => new Response(null, { status: 200 });
  expect((await call()).status).toBe(502);
});
