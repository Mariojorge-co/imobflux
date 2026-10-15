import "./helpers/server-only";

import { expect, test } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-require-imports */
const serverSupabaseModule = require("@/lib/supabase/server");
const adminSupabaseModule = require("@/lib/supabase/admin");
const gatewayModule = require("@/lib/supabase/gateway");
delete require.cache[require.resolve("../lib/conversations/media-send")];
const mediaModule = require("@/lib/conversations/media-send");
/* eslint-enable @typescript-eslint/no-require-imports */

const WORKSPACE = "b6100002-0000-4000-8000-000000000001";
const OTHER_WORKSPACE = "b6100002-0000-4000-8000-000000000002";
const CONVERSATION = "b6100003-0000-4000-8000-000000000001";
const KEY = "b6100004-0000-4000-8000-000000000001";
const SIGNED = "https://projeto.supabase.test/storage/v1/object/sign/whatsapp-media/segredo?token=TOKEN-SECRETO";
const originalFetch = globalThis.fetch;
const originalServer = serverSupabaseModule.createServerSupabaseClient;
const originalAdmin = adminSupabaseModule.createAdminSupabaseClient;
const originalSendMedia = gatewayModule.sendEvolutionMedia;
const originalError = console.error;

type Calls = {
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  adminRpc: Array<{ name: string; args: Record<string, unknown> }>;
  removed: string[][];
  copied: Array<[string, string]>;
  signedUploadPaths: string[];
  gateway: Array<Record<string, unknown>>;
  logs: string[];
};

const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF_HEAD = new TextEncoder().encode("%PDF-1.7\n");
const EXE_HEAD = new Uint8Array([0x4d, 0x5a, 0x90, 0]);

function install(options: {
  user?: boolean;
  conversation?: { id: string; workspace_id: string } | null;
  stored?: { bytes: Uint8Array; total: number } | null;
  queue?: Record<string, unknown> | { error: { code: string } };
  gateway?: Record<string, unknown>;
  failedMessage?: Record<string, unknown> | null;
  usedAttachment?: boolean;
}): Calls {
  const calls: Calls = { rpc: [], adminRpc: [], removed: [], copied: [], signedUploadPaths: [], gateway: [], logs: [] };
  console.error = (...args: unknown[]) => calls.logs.push(args.map(String).join(" "));

  serverSupabaseModule.createServerSupabaseClient = async () => ({
    auth: { getUser: async () => ({ data: { user: options.user === false ? null : { id: "u1" } }, error: null }) },
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.limit = async () => ({ data: options.usedAttachment ? [{ id: "a1" }] : [], error: null });
      builder.maybeSingle = async () => {
        if (table === "conversations") return { data: options.conversation === undefined ? { id: CONVERSATION, workspace_id: WORKSPACE } : options.conversation, error: null };
        if (table === "messages") return { data: options.failedMessage ?? null, error: null };
        return { data: null, error: null };
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      const q = options.queue ?? { status: "queued", message_id: "m1", attachment_id: "a1", recipient_target: "5582988880000@s.whatsapp.net", instance_name: "inst" };
      if ("error" in q) return { data: null, error: q.error };
      return { data: q, error: null };
    },
  });

  adminSupabaseModule.createAdminSupabaseClient = () => ({
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          calls.signedUploadPaths.push(path);
          return { data: { signedUrl: `https://projeto.supabase.test/upload/${path}?token=T`, token: "T", path }, error: null };
        },
        createSignedUrl: async () => ({ data: { signedUrl: SIGNED }, error: null }),
        remove: async (paths: string[]) => {
          calls.removed.push(paths);
          return { error: null };
        },
        copy: async (from: string, to: string) => {
          calls.copied.push([from, to]);
          return { data: { path: to }, error: null };
        },
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.adminRpc.push({ name, args });
      return { data: null, error: null };
    },
  });

  gatewayModule.sendEvolutionMedia = async (instance: string, to: string, input: Record<string, unknown>) => {
    calls.gateway.push({ instance, to, ...input });
    return options.gateway ?? { success: true, externalMessageId: "EXT-1" };
  };

  globalThis.fetch = (async () => {
    if (options.stored === null) return new Response("nao", { status: 404 });
    const stored = options.stored ?? { bytes: PDF_HEAD, total: 1234 };
    return new Response(stored.bytes as BodyInit, { status: 206, headers: { "content-range": `bytes 0-${stored.bytes.length - 1}/${stored.total}` } });
  }) as typeof fetch;
  return calls;
}

test.afterEach(() => {
  serverSupabaseModule.createServerSupabaseClient = originalServer;
  adminSupabaseModule.createAdminSupabaseClient = originalAdmin;
  gatewayModule.sendEvolutionMedia = originalSendMedia;
  globalThis.fetch = originalFetch;
  console.error = originalError;
});

const path = (workspace = WORKSPACE, conversation = CONVERSATION) => `${workspace}/${conversation}/out/b6100005-0000-4000-8000-000000000001`;
const send = (overrides: Record<string, unknown> = {}) =>
  mediaModule.sendOutgoingMediaAction({ conversationId: CONVERSATION, path: path(), fileName: "contrato.pdf", caption: "", asDocument: false, idempotencyKey: KEY, ...overrides });

test.describe("prepareOutgoingUploadAction", () => {
  test("sem sessão: UNAUTHORIZED; conversa que a pessoa não vê: nada é autorizado", async () => {
    install({ user: false });
    expect(await mediaModule.prepareOutgoingUploadAction({ conversationId: CONVERSATION, fileName: "a.pdf", size: 10 })).toMatchObject({ success: false, code: "UNAUTHORIZED" });
    const calls = install({ conversation: null });
    expect(await mediaModule.prepareOutgoingUploadAction({ conversationId: CONVERSATION, fileName: "a.pdf", size: 10 })).toMatchObject({ success: false, code: "CONVERSATION_NOT_AVAILABLE" });
    expect(calls.signedUploadPaths).toHaveLength(0);
  });

  test("recusa executável, tipo desconhecido, vazio e acima de 25 MB ANTES de gerar a URL de upload", async () => {
    const calls = install({});
    for (const [fileName, size, code] of [
      ["setup.exe", 100, "BLOCKED_TYPE"],
      ["algo.xyz", 100, "UNSUPPORTED_TYPE"],
      ["vazio.pdf", 0, "EMPTY"],
      ["grande.pdf", 26 * 1024 * 1024, "TOO_LARGE"],
    ] as const) {
      expect(await mediaModule.prepareOutgoingUploadAction({ conversationId: CONVERSATION, fileName, size })).toMatchObject({ success: false, code });
    }
    expect(calls.signedUploadPaths).toHaveLength(0);
  });

  test("autoriza: caminho no workspace e na conversa (nunca de outro) e URL assinada", async () => {
    const calls = install({});
    const result = await mediaModule.prepareOutgoingUploadAction({ conversationId: CONVERSATION, fileName: "contrato.pdf", size: 5000 });
    expect(result.success).toBe(true);
    expect(result.path).toMatch(new RegExp(`^${WORKSPACE}/${CONVERSATION}/out/[0-9a-f-]{36}$`));
    expect(result.path).not.toContain("contrato");
    expect(calls.signedUploadPaths).toEqual([result.path]);
    expect(result.token).toBe("T");
  });
});

test.describe("sendOutgoingMediaAction", () => {
  test("caminho de OUTRO workspace ou de outra conversa é recusado", async () => {
    const calls = install({});
    expect(await send({ path: path(OTHER_WORKSPACE) })).toMatchObject({ success: false, code: "INVALID_INPUT" });
    expect(await send({ path: path(WORKSPACE, "b6100003-0000-4000-8000-0000000000ff") })).toMatchObject({ success: false, code: "INVALID_INPUT" });
    expect(await send({ path: `${WORKSPACE}/${CONVERSATION}/out/../../x` })).toMatchObject({ success: false, code: "INVALID_INPUT" });
    expect(calls.rpc).toHaveLength(0);
    expect(calls.gateway).toHaveLength(0);
  });

  test("conversa que a pessoa não acessa: nada é enfileirado nem enviado", async () => {
    const calls = install({ conversation: null });
    expect(await send()).toMatchObject({ success: false, code: "CONVERSATION_NOT_AVAILABLE" });
    expect(calls.rpc).toHaveLength(0);
  });

  test("arquivo que não chegou ao Storage: UPLOAD_MISSING", async () => {
    install({ stored: null });
    expect(await send()).toMatchObject({ success: false, code: "UPLOAD_MISSING" });
  });

  test("tipo pelo CONTEÚDO: executável disfarçado de foto é bloqueado e apagado do Storage", async () => {
    const calls = install({ stored: { bytes: EXE_HEAD, total: 500 } });
    expect(await send({ fileName: "foto.jpg" })).toMatchObject({ success: false, code: "BLOCKED_TYPE" });
    expect(calls.removed).toEqual([[path()]]);
    expect(calls.rpc).toHaveLength(0);
    expect(calls.gateway).toHaveLength(0);
  });

  test("conteúdo diferente da extensão (JPEG com nome .pdf): CONTENT_MISMATCH e o arquivo é apagado", async () => {
    const calls = install({ stored: { bytes: JPEG_HEAD, total: 500 } });
    expect(await send({ fileName: "contrato.pdf" })).toMatchObject({ success: false, code: "CONTENT_MISMATCH" });
    expect(calls.removed).toHaveLength(1);
  });

  test("tamanho REAL guardado acima de 25 MB é recusado mesmo que o navegador tenha dito outro", async () => {
    install({ stored: { bytes: PDF_HEAD, total: 26 * 1024 * 1024 } });
    expect(await send()).toMatchObject({ success: false, code: "TOO_LARGE" });
  });

  test("legenda acima de 1024 caracteres é recusada", async () => {
    install({});
    expect(await send({ caption: "x".repeat(1025) })).toMatchObject({ success: false, code: "CAPTION_TOO_LONG" });
  });

  test("sucesso: enfileira com o tipo detectado, envia pela Evolution com URL assinada e reconcilia", async () => {
    const calls = install({ stored: { bytes: PDF_HEAD, total: 98765 } });
    const result = await send({ caption: "  Segue  " });
    expect(result).toMatchObject({ success: true, status: "sent", messageId: "m1" });
    const queued = calls.rpc.find((entry) => entry.name === "queue_outgoing_media_message")!;
    expect(queued.args).toMatchObject({
      p_conversation_id: CONVERSATION,
      p_client_idempotency_key: KEY,
      p_storage_key: path(),
      p_file_name: "contrato.pdf",
      p_mime_type: "application/pdf",
      p_size_bytes: 98765,
      p_text_content: "Segue",
    });
    expect(calls.gateway).toEqual([
      { instance: "inst", to: "5582988880000@s.whatsapp.net", mediatype: "document", mimetype: "application/pdf", fileName: "contrato.pdf", caption: "Segue", mediaUrl: SIGNED },
    ]);
    expect(calls.adminRpc.map((entry) => entry.name)).toEqual(["reconcile_outgoing_text_message", "record_outgoing_media_sent"]);
    expect(calls.adminRpc[0].args).toMatchObject({ p_message_id: "m1", p_target_status: "sent", p_external_message_id: "EXT-1" });
    expect(calls.adminRpc[1].args).toMatchObject({ p_message_id: "m1", p_media_kind: "document" });
  });

  test("sem legenda a mensagem leva o rótulo do arquivo; imagem 'como documento' vai como document", async () => {
    const calls = install({ stored: { bytes: JPEG_HEAD, total: 4000 } });
    await send({ fileName: "planta.jpg", asDocument: true });
    const queued = calls.rpc.find((entry) => entry.name === "queue_outgoing_media_message")!;
    expect(queued.args.p_text_content).toBe("📄 Documento: planta.jpg");
    expect(queued.args.p_mime_type).toBe("image/jpeg");
    expect(calls.gateway[0]).toMatchObject({ mediatype: "document", mimetype: "image/jpeg" });
    const calls2 = install({ stored: { bytes: JPEG_HEAD, total: 4000 } });
    await send({ fileName: "foto.jpg" });
    expect(calls2.gateway[0]).toMatchObject({ mediatype: "image" });
    expect(calls2.rpc[0].args.p_text_content).toBe("📷 Imagem");
  });

  test("falha da Evolution: falha classificada, mensagem marcada como falhou e NADA sensível vaza (URL assinada, nome, caminho)", async () => {
    const calls = install({ gateway: { success: false, code: "HTTP_500", error: "Evolution API retornou erro HTTP 500" } });
    const result = await send();
    expect(result).toMatchObject({ success: false, code: "EVOLUTION_REJECTED" });
    expect(calls.adminRpc[0].args).toMatchObject({ p_target_status: "failed" });
    expect(calls.adminRpc.map((entry) => entry.name)).not.toContain("record_outgoing_media_sent");
    const everything = JSON.stringify(result) + calls.logs.join("\n");
    expect(everything).not.toContain("TOKEN-SECRETO");
    expect(everything).not.toContain("contrato.pdf");
    expect(everything).not.toContain(path());
    expect(everything).not.toContain(CONVERSATION);
  });

  test("distingue os motivos: timeout, rede, conexão desligada e destinatário inválido", async () => {
    install({ gateway: { success: false, code: "TIMEOUT", error: "x" } });
    expect(await send()).toMatchObject({ success: false, code: "GATEWAY_TIMEOUT" });
    install({ gateway: { success: false, code: "NETWORK_ERROR", error: "x" } });
    expect(await send()).toMatchObject({ success: false, code: "GATEWAY_NETWORK" });
    install({ gateway: { success: false, code: "INVALID_PHONE", error: "x" } });
    expect(await send()).toMatchObject({ success: false, code: "INVALID_RECIPIENT" });
    install({ queue: { status: "queued", message_id: "m1", attachment_id: "a1", recipient_target: "5582988880000@s.whatsapp.net", instance_name: null } });
    expect(await send()).toMatchObject({ success: false, code: "WHATSAPP_DISCONNECTED" });
  });

  test("erros do banco viram códigos de falha (sem permissão, conversa indisponível, arquivo já usado)", async () => {
    install({ queue: { error: { code: "42501" } } });
    expect(await send()).toMatchObject({ success: false, code: "NOT_AUTHORIZED" });
    install({ queue: { error: { code: "42704" } } });
    expect(await send()).toMatchObject({ success: false, code: "CONVERSATION_NOT_AVAILABLE" });
    install({ queue: { error: { code: "23505" } } });
    expect(await send()).toMatchObject({ success: false, code: "MEDIA_ALREADY_USED" });
  });

  test("mesma chave de idempotência: não envia de novo; se a anterior falhou, pede 'tentar de novo'", async () => {
    const calls = install({ queue: { status: "duplicate", message_id: "m1", message_status: "sent" } });
    expect(await send()).toMatchObject({ success: true, status: "duplicate" });
    expect(calls.gateway).toHaveLength(0);
    install({ queue: { status: "duplicate", message_id: "m1", message_status: "failed" } });
    expect(await send()).toMatchObject({ success: false, code: "PREVIOUSLY_FAILED" });
  });
});

test.describe("retryOutgoingMediaAction", () => {
  const failedMessage = (overrides: Record<string, unknown> = {}) => ({
    id: "b6100006-0000-4000-8000-000000000001",
    workspace_id: WORKSPACE,
    conversation_id: CONVERSATION,
    direction: "outgoing",
    origin: "crm",
    status: "failed",
    text_content: "📄 Documento: contrato.pdf",
    attachments: [{ storage_bucket: "whatsapp-media", storage_key: path(), original_file_name: "contrato.pdf", mime_type: "application/pdf", size_bytes: 2000 }],
    ...overrides,
  });
  const retry = () => mediaModule.retryOutgoingMediaAction({ messageId: "b6100006-0000-4000-8000-000000000001", idempotencyKey: KEY });

  test("só vale para mensagem de saída do CRM que falhou e tem exatamente um arquivo do próprio caminho", async () => {
    install({ failedMessage: failedMessage({ status: "sent" }) });
    expect(await retry()).toMatchObject({ success: false, code: "RETRY_NOT_ALLOWED" });
    install({ failedMessage: failedMessage({ direction: "incoming" }) });
    expect(await retry()).toMatchObject({ success: false, code: "RETRY_NOT_ALLOWED" });
    install({ failedMessage: failedMessage({ attachments: [] }) });
    expect(await retry()).toMatchObject({ success: false, code: "RETRY_NOT_ALLOWED" });
    install({ failedMessage: failedMessage({ attachments: [{ storage_bucket: "whatsapp-media", storage_key: path(OTHER_WORKSPACE), original_file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10 }] }) });
    expect(await retry()).toMatchObject({ success: false, code: "RETRY_NOT_ALLOWED" });
    install({ failedMessage: null });
    expect(await retry()).toMatchObject({ success: false });
  });

  test("copia o arquivo para um caminho novo e envia como nova mensagem (sem legenda: só o rótulo)", async () => {
    const calls = install({ failedMessage: failedMessage() });
    const result = await retry();
    expect(result).toMatchObject({ success: true, status: "sent" });
    expect(calls.copied).toHaveLength(1);
    expect(calls.copied[0][0]).toBe(path());
    expect(calls.copied[0][1]).not.toBe(path());
    expect(calls.copied[0][1]).toMatch(new RegExp(`^${WORKSPACE}/${CONVERSATION}/out/[0-9a-f-]{36}$`));
    expect(calls.rpc[0].args).toMatchObject({ p_storage_key: calls.copied[0][1], p_client_idempotency_key: KEY, p_text_content: "📄 Documento: contrato.pdf" });
    expect(calls.gateway[0]).toMatchObject({ mediatype: "document", fileName: "contrato.pdf" });
    expect(calls.gateway[0].caption).toBeNull();
  });

  test("mantém a legenda original da mensagem que falhou", async () => {
    const calls = install({ failedMessage: failedMessage({ text_content: "Segue o contrato" }) });
    await retry();
    expect(calls.gateway[0]).toMatchObject({ caption: "Segue o contrato" });
  });
});

test.describe("discardOutgoingUploadAction", () => {
  test("apaga só um upload do próprio workspace/conversa que ainda não virou mensagem", async () => {
    let calls = install({});
    expect(await mediaModule.discardOutgoingUploadAction({ conversationId: CONVERSATION, path: path() })).toEqual({ success: true });
    expect(calls.removed).toEqual([[path()]]);
    calls = install({});
    expect(await mediaModule.discardOutgoingUploadAction({ conversationId: CONVERSATION, path: path(OTHER_WORKSPACE) })).toEqual({ success: false });
    expect(calls.removed).toHaveLength(0);
    calls = install({ usedAttachment: true });
    expect(await mediaModule.discardOutgoingUploadAction({ conversationId: CONVERSATION, path: path() })).toEqual({ success: false });
    expect(calls.removed).toHaveLength(0);
  });
});

test.describe("sendEvolutionMedia (contrato da Evolution v2)", () => {
  const env = { ...process.env };
  test.afterEach(() => {
    process.env.EVOLUTION_API_URL = env.EVOLUTION_API_URL;
    process.env.EVOLUTION_API_KEY = env.EVOLUTION_API_KEY;
    process.env.EVOLUTION_INSTANCE_NAME = env.EVOLUTION_INSTANCE_NAME;
  });

  test("POST /message/sendMedia/{instância} com number, mediatype, mimetype, fileName, caption e media (URL)", async () => {
    process.env.EVOLUTION_API_URL = "https://evolution.example/";
    process.env.EVOLUTION_API_KEY = "chave-de-teste";
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ key: { id: "ABC123" } }), { status: 201 });
    }) as typeof fetch;
    const result = await originalSendMedia("minha instancia", "5582988880000@s.whatsapp.net", {
      mediatype: "document",
      mimetype: "application/pdf",
      fileName: "contrato.pdf",
      caption: "  Segue ",
      mediaUrl: SIGNED,
    });
    expect(result).toEqual({ success: true, externalMessageId: "ABC123" });
    expect(captured!.url).toBe("https://evolution.example/message/sendMedia/minha%20instancia");
    expect(captured!.init.method).toBe("POST");
    expect((captured!.init.headers as Record<string, string>).apikey).toBe("chave-de-teste");
    expect(JSON.parse(String(captured!.init.body))).toEqual({
      number: "5582988880000",
      mediatype: "document",
      mimetype: "application/pdf",
      fileName: "contrato.pdf",
      caption: "Segue",
      media: SIGNED,
    });
  });

  test("sem legenda o campo caption não é enviado; sem configuração/instância/telefone válido: falhas distintas", async () => {
    process.env.EVOLUTION_API_URL = "https://evolution.example";
    process.env.EVOLUTION_API_KEY = "k";
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ key: { id: "X" } }), { status: 201 });
    }) as typeof fetch;
    await originalSendMedia("i", "5582988880000@s.whatsapp.net", { mediatype: "image", mimetype: "image/png", fileName: "a.png", mediaUrl: SIGNED });
    expect("caption" in body).toBe(false);

    expect(await originalSendMedia("i", "123", { mediatype: "image", mimetype: "image/png", fileName: "a.png", mediaUrl: SIGNED })).toMatchObject({ success: false, code: "INVALID_PHONE" });
    delete process.env.EVOLUTION_INSTANCE_NAME;
    expect(await originalSendMedia("", "5582988880000@s.whatsapp.net", { mediatype: "image", mimetype: "image/png", fileName: "a.png", mediaUrl: SIGNED })).toMatchObject({ success: false, code: "MISSING_INSTANCE" });
    delete process.env.EVOLUTION_API_KEY;
    expect(await originalSendMedia("i", "5582988880000@s.whatsapp.net", { mediatype: "image", mimetype: "image/png", fileName: "a.png", mediaUrl: SIGNED })).toMatchObject({ success: false, code: "MISSING_ENV_CONFIG" });
  });

  test("erros HTTP, rede e resposta sem key.id têm código curto e nunca carregam URL assinada nem nome do arquivo", async () => {
    process.env.EVOLUTION_API_URL = "https://evolution.example";
    process.env.EVOLUTION_API_KEY = "k";
    const input = { mediatype: "document" as const, mimetype: "application/pdf", fileName: "segredo-contrato.pdf", mediaUrl: SIGNED };
    globalThis.fetch = (async () => new Response("detalhe interno com TOKEN-SECRETO", { status: 500 })) as typeof fetch;
    const http = await originalSendMedia("i", "5582988880000@s.whatsapp.net", input);
    expect(http).toMatchObject({ success: false, code: "HTTP_500" });
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED https://evolution.example com TOKEN-SECRETO");
    }) as typeof fetch;
    const network = await originalSendMedia("i", "5582988880000@s.whatsapp.net", input);
    expect(network).toMatchObject({ success: false, code: "NETWORK_ERROR" });
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as typeof fetch;
    const missing = await originalSendMedia("i", "5582988880000@s.whatsapp.net", input);
    expect(missing).toMatchObject({ success: false, code: "MISSING_EXTERNAL_ID" });
    for (const result of [http, network, missing]) {
      const text = JSON.stringify(result);
      expect(text).not.toContain("TOKEN-SECRETO");
      expect(text).not.toContain("segredo-contrato");
      expect(text).not.toContain("evolution.example");
    }
  });
});
