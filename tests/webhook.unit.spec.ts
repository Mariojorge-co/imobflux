// 1. Bypass do marker 'server-only' para execução em ambiente Node de testes
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };
} catch {
  // Ignorar se não puder ser resolvido
}

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminModule = require("@/lib/supabase/admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routeModule = require("@/app/api/webhooks/whatsapp/route");
const POST = routeModule.POST;

const originalCreateAdminSupabaseClient = adminModule.createAdminSupabaseClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mediaModule = require("@/lib/conversations/media-download");
const originalScheduleMediaDownload = mediaModule.scheduleMediaDownload;
const originalStoreAttachmentMedia = mediaModule.storeAttachmentMedia;

// Helper para construir requisições HTTP mockadas
function createMockRequest(options: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
}) {
  const headers = new Headers(options.headers ?? {});
  let bodyContent: string | undefined;

  if (options.rawBody !== undefined) {
    bodyContent = options.rawBody;
  } else if (options.body !== undefined) {
    bodyContent = JSON.stringify(options.body);
  }

  return new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: options.method ?? "POST",
    headers,
    body: bodyContent,
  });
}

test.describe("Evolution API Webhook Route Handler & Parser Complete Unit Tests", () => {
  const originalEnv = process.env;
  let rpcCalls: Array<{ fnName: string; args: Record<string, unknown> }> = [];
  let scheduledDownloads: Array<() => Promise<unknown>> = [];
  let storedDownloads: Array<{ attachmentId: string; source: unknown }> = [];
  let rpcMockResult: { data: unknown; error: unknown } = {
    data: { status: "success", message_id: "msg-uuid-123" },
    error: null,
  };

  test.beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.EVOLUTION_WEBHOOK_SECRET = "secret_token_123";
    process.env.SUPABASE_ADMIN_KEY = "admin_key_secret";

    rpcCalls = [];
    rpcMockResult = {
      data: { status: "success", message_id: "msg-uuid-123" },
      error: null,
    };

    // O download da mídia roda depois da resposta: nos testes, apenas registramos o agendamento.
    scheduledDownloads = [];
    storedDownloads = [];
    mediaModule.scheduleMediaDownload = (task: () => Promise<unknown>) => { scheduledDownloads.push(task); };
    mediaModule.storeAttachmentMedia = async (_admin: unknown, attachmentId: string, source: unknown) => {
      storedDownloads.push({ attachmentId, source });
      return { status: "available" };
    };

    // Mock do client administrativo Supabase
    adminModule.createAdminSupabaseClient = () => {
      return {
        rpc: async (fnName: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fnName, args });
          return rpcMockResult;
        },
      };
    };
  });

  test.afterEach(() => {
    process.env = originalEnv;
    rpcMockResult = {
      data: { status: "success", message_id: "msg-uuid-123" },
      error: null,
    };
    adminModule.createAdminSupabaseClient = originalCreateAdminSupabaseClient;
    mediaModule.scheduleMediaDownload = originalScheduleMediaDownload;
    mediaModule.storeAttachmentMedia = originalStoreAttachmentMedia;
  });

  // 1. POST sem segredo retorna 401
  test("1. POST sem segredo retorna 401 Unauthorized", async () => {
    const req = createMockRequest({
      headers: {},
      body: { event: "messages.upsert", instance: "inst-1", data: {} },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Não autorizado");
  });

  // 2. POST com segredo incorreto retorna 401
  test("2. POST com segredo incorreto retorna 401 Unauthorized", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "wrong_secret" },
      body: { event: "messages.upsert", instance: "inst-1", data: {} },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Não autorizado");
  });

  // 3. JSON inválido retorna 400
  test("3. JSON inválido retorna 400 Bad Request", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      rawBody: "invalid_json{{{",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Payload JSON inválido");
  });

  // 4. Evento desconhecido retorna 200 sem chamar RPC
  test("4. evento desconhecido retorna HTTP 200 sem chamar RPC", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: { event: "connection.update", instance: "inst-1", data: {} },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ignored");
    expect(json.reason).toBe("unhandled_event");
    expect(rpcCalls.length).toBe(0);
  });

  // 5. Grupo (@g.us) usa a RPC dedicada sem materializar lead.
  test("5. mensagem de grupo (@g.us) chama a RPC dedicada", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "inst-1",
        data: {
          key: {
            remoteJid: "120363041999999999@g.us",
            fromMe: false,
            id: "msg-1",
            participant: "5582988880000@s.whatsapp.net",
          },
          pushName: "Grupo Imobiliária",
          messageTimestamp: 1700000000,
          message: { conversation: "Olá grupo" },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("success");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fnName).toBe("ingest_whatsapp_group_text_message");
  });

  // 6. Mensagem sem texto e sem mídia reconhecida (ex.: reação) segue ignorada
  test("6. mensagem sem texto e sem mídia reconhecida retorna HTTP 200 sem chamar RPC", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "inst-1",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-react-1",
          },
          pushName: "João",
          messageTimestamp: 1700000000,
          message: { reactionMessage: { text: "👍" } },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ignored");
    expect(json.reason).toBe("non_text_message_ignored");
    expect(rpcCalls.length).toBe(0);
  });

  // 6b. Mídia (imagem, PDF, áudio) agora é ingerida e registra o anexo
  function mediaRequest(message: Record<string, unknown>, overrides: { jid?: string; participant?: string; fromMe?: boolean } = {}) {
    return createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "inst-1",
        data: {
          key: {
            remoteJid: overrides.jid ?? "5582988880000@s.whatsapp.net",
            fromMe: overrides.fromMe ?? false,
            id: "msg-media-1",
            ...(overrides.participant ? { participant: overrides.participant } : {}),
          },
          pushName: "Cliente",
          messageTimestamp: 1700000000,
          message,
        },
      },
    });
  }

  test("6b. imagem com legenda: ingere a legenda como texto e registra o anexo", async () => {
    const res = await POST(mediaRequest({ imageMessage: { caption: "Foto da casa", mimetype: "image/jpeg", fileLength: "245760" } }));
    expect(res.status).toBe(200);
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_text_message", "attach_whatsapp_media"]);
    expect(rpcCalls[0].args.p_text_content).toBe("Foto da casa");
    expect(rpcCalls[1].args).toEqual({
      p_message_id: "msg-uuid-123",
      p_media_kind: "image",
      p_file_name: "",
      p_mime_type: "image/jpeg",
      p_size_bytes: 245760,
    });
  });

  test("6c. PDF sem legenda: texto legível com o nome do arquivo e anexo com mime e tamanho", async () => {
    const res = await POST(mediaRequest({ documentMessage: { mimetype: "application/pdf", fileName: "holerite.pdf", fileLength: 120000 } }));
    expect(res.status).toBe(200);
    expect(rpcCalls[0].args.p_text_content).toBe("📄 Documento: holerite.pdf");
    expect(rpcCalls[1]).toEqual({
      fnName: "attach_whatsapp_media",
      args: { p_message_id: "msg-uuid-123", p_media_kind: "document", p_file_name: "holerite.pdf", p_mime_type: "application/pdf", p_size_bytes: 120000 },
    });
  });

  test("6d. documento com legenda (documentWithCaptionMessage) é reconhecido", async () => {
    await POST(mediaRequest({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: "application/pdf", fileName: "rg.pdf", caption: "Segue meu RG" } } } }));
    expect(rpcCalls[0].args.p_text_content).toBe("Segue meu RG");
    expect(rpcCalls[1].args).toMatchObject({ p_media_kind: "document", p_file_name: "rg.pdf" });
  });

  test("6e. áudio e mensagem de voz: ingere com rótulo e registra o anexo", async () => {
    await POST(mediaRequest({ audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true, fileLength: { low: 9000, high: 0 } } }));
    expect(rpcCalls[0].args.p_text_content).toBe("🎤 Mensagem de voz");
    expect(rpcCalls[1].args).toMatchObject({ p_media_kind: "audio", p_size_bytes: 9000 });

    rpcCalls = [];
    await POST(mediaRequest({ audioMessage: { mimetype: "audio/mpeg" } }));
    expect(rpcCalls[0].args.p_text_content).toBe("🎧 Áudio");
    expect(rpcCalls[1].args.p_size_bytes).toBeUndefined();
  });

  test("6f. mídia em grupo usa a RPC de grupo e depois registra o anexo", async () => {
    await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }, { jid: "120363041999999999@g.us", participant: "5582988880000@s.whatsapp.net" }));
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_group_text_message", "attach_whatsapp_media"]);
    expect(rpcCalls[0].args.p_text_content).toBe("📷 Imagem");
  });

  test("6g. reentrega (duplicate) ainda garante o anexo; ignored/erro de ingestão não registra anexo", async () => {
    rpcMockResult = { data: { status: "duplicate", message_id: "msg-uuid-123" }, error: null };
    await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }));
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_text_message", "attach_whatsapp_media"]);

    rpcCalls = [];
    rpcMockResult = { data: { status: "ignored", reason: "invalid_phone" }, error: null };
    await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }));
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_text_message"]);

    rpcCalls = [];
    rpcMockResult = { data: null, error: { message: "boom" } };
    const failed = await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }));
    expect(failed.status).toBe(500);
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_text_message"]);
  });

  test("6h. falha ao registrar o anexo retorna 500 (provedor pode reenviar) sem vazar detalhes", async () => {
    adminModule.createAdminSupabaseClient = () => ({
      rpc: async (fnName: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fnName, args });
        return fnName === "attach_whatsapp_media"
          ? { data: null, error: { message: "detalhe interno do banco" } }
          : rpcMockResult;
      },
    });
    const res = await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("detalhe interno");
  });

  function adminWithAttachment(attachResult: { data: unknown; error: unknown }) {
    adminModule.createAdminSupabaseClient = () => ({
      rpc: async (fnName: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fnName, args });
        return fnName === "attach_whatsapp_media" ? attachResult : rpcMockResult;
      },
    });
  }

  test("6j. mídia nova agenda o download depois da resposta, com a chave da mensagem e a instância", async () => {
    adminWithAttachment({ data: { status: "success", attachment_id: "att-1", attachment_status: "pending" }, error: null });
    const res = await POST(mediaRequest({ documentMessage: { mimetype: "application/pdf", fileName: "rg.pdf" } }));
    expect(res.status).toBe(200);
    // A resposta já saiu; o trabalho só está agendado, ainda não executou.
    expect(scheduledDownloads).toHaveLength(1);
    expect(storedDownloads).toHaveLength(0);

    await scheduledDownloads[0]();
    expect(storedDownloads).toEqual([{
      attachmentId: "att-1",
      source: {
        instance: "inst-1",
        key: { id: "msg-media-1", remoteJid: "5582988880000@s.whatsapp.net", fromMe: false, participant: null },
        inlineBase64: null,
      },
    }]);
  });

  test("6k. em grupo a chave leva o participante; base64 do webhook é repassado sem nova chamada", async () => {
    adminWithAttachment({ data: { status: "success", attachment_id: "att-2", attachment_status: "pending" }, error: null });
    await POST(mediaRequest(
      { imageMessage: { mimetype: "image/png" }, base64: "aGVsbG8=" },
      { jid: "120363041999999999@g.us", participant: "5582988881111@s.whatsapp.net" },
    ));
    await scheduledDownloads[0]();
    expect(storedDownloads[0]).toMatchObject({
      attachmentId: "att-2",
      source: { key: { remoteJid: "120363041999999999@g.us", participant: "5582988881111@s.whatsapp.net" }, inlineBase64: "aGVsbG8=" },
    });
  });

  test("6l. anexo já disponível (reentrega) não agenda novo download", async () => {
    adminWithAttachment({ data: { status: "duplicate", attachment_id: "att-1", attachment_status: "available" }, error: null });
    await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }));
    expect(scheduledDownloads).toHaveLength(0);
  });

  test("6m. reentrega de anexo ainda pendente agenda de novo (recupera download que não terminou)", async () => {
    adminWithAttachment({ data: { status: "duplicate", attachment_id: "att-1", attachment_status: "unavailable" }, error: null });
    await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }));
    expect(scheduledDownloads).toHaveLength(1);
  });

  test("6n. falha ao registrar o anexo não agenda download; texto nunca agenda", async () => {
    adminWithAttachment({ data: null, error: { message: "boom" } });
    expect((await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }))).status).toBe(500);
    expect(scheduledDownloads).toHaveLength(0);

    adminWithAttachment({ data: { status: "success", attachment_id: "att-9", attachment_status: "pending" }, error: null });
    await POST(mediaRequest({ conversation: "só texto" }));
    expect(scheduledDownloads).toHaveLength(0);
  });

  test("6o. o webhook responde 200 mesmo que o download falhe depois (a mensagem já foi gravada)", async () => {
    adminWithAttachment({ data: { status: "success", attachment_id: "att-1", attachment_status: "pending" }, error: null });
    mediaModule.storeAttachmentMedia = async () => ({ status: "failed", code: "NETWORK_ERROR" });
    const res = await POST(mediaRequest({ imageMessage: { mimetype: "image/png" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("success");
    await expect(scheduledDownloads[0]()).resolves.toEqual({ status: "failed", code: "NETWORK_ERROR" });
  });

  test("6i. texto continua com uma única RPC (sem anexo)", async () => {
    const res = await POST(mediaRequest({ conversation: "só texto" }));
    expect(res.status).toBe(200);
    expect(rpcCalls.map((call) => call.fnName)).toEqual(["ingest_whatsapp_text_message"]);
  });

  // 7. Payload textual válido chama RPC ingest_whatsapp_text_message com argumentos esperados
  test("7. payload textual válido chama ingest_whatsapp_text_message com argumentos esperados", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "instancia_mario",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-ext-777",
          },
          pushName: "Mario Jorge",
          messageTimestamp: 1700000000,
          message: { conversation: "Olá, tenho interesse no imóvel." },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.message_id).toBe("msg-uuid-123");

    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0]).toEqual({
      fnName: "ingest_whatsapp_text_message",
      args: {
        p_external_account_id: "instancia_mario",
        p_remote_jid: "5582988880000@s.whatsapp.net",
        p_from_me: false,
        p_external_message_id: "msg-ext-777",
        p_push_name: "Mario Jorge",
        p_occurred_at: "2023-11-14T22:13:20.000Z",
        p_text_content: "Olá, tenho interesse no imóvel.",
      },
    });
  });

  // 8. Resultado duplicate da RPC é tratado como sucesso HTTP 200
  test("8. resultado duplicate da RPC é tratado como sucesso HTTP 200", async () => {
    rpcMockResult = {
      data: { status: "duplicate", message_id: "msg-uuid-123" },
      error: null,
    };

    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "instancia_mario",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-ext-777",
          },
          pushName: "Mario Jorge",
          messageTimestamp: 1700000000,
          message: { conversation: "Mensagem repetida" },
        },
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("duplicate");
    expect(json.message_id).toBe("msg-uuid-123");
  });

  // 9. Erro de RPC/instância inexistente retorna HTTP 500 sem detalhes SQL
  test("9. erro de RPC/instância inexistente retorna HTTP 500 sem detalhes SQL", async () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      rpcMockResult = {
        data: null,
        error: {
          message: "Conexão de canal não encontrada para a instância",
          code: "42704",
        },
      };

      const req = createMockRequest({
        headers: { "x-evolution-secret": "secret_token_123" },
        body: {
          event: "messages.upsert",
          instance: "instancia_desconhecida",
          data: {
            key: {
              remoteJid: "5582988880000@s.whatsapp.net",
              fromMe: false,
              id: "msg-ext-999",
            },
            pushName: "Desconhecido",
            messageTimestamp: 1700000000,
            message: { conversation: "Olá" },
          },
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Erro interno no processamento do webhook");
      expect(json.error).not.toContain("42704");
      expect(json.error).not.toContain("Conexão de canal");
    } finally {
      console.error = originalConsoleError;
    }
  });

  // 10. Nenhuma resposta de erro ou sucesso expõe segredos ou chaves internas
  test("10. nenhuma resposta de erro ou sucesso expõe segredos ou chaves internas", async () => {
    const req = createMockRequest({
      headers: { "x-evolution-secret": "secret_token_123" },
      body: {
        event: "messages.upsert",
        instance: "inst-1",
        data: {
          key: {
            remoteJid: "5582988880000@s.whatsapp.net",
            fromMe: false,
            id: "msg-ext-1",
          },
          pushName: "Teste Segredos",
          messageTimestamp: 1700000000,
          message: { conversation: "Teste" },
        },
      },
    });

    const res = await POST(req);
    const text = await res.text();

    expect(text).not.toContain("secret_token_123");
    expect(text).not.toContain("admin_key_secret");
  });

  // 11. Validação de métodos HTTP suportados
  test("11. validação de métodos HTTP suportados pelo Route Handler", async () => {
    const req = createMockRequest({
      method: "GET",
      headers: { "x-evolution-secret": "secret_token_123" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // 12. Falha fechado: sem EVOLUTION_WEBHOOK_SECRET nenhuma requisição é aceita
  for (const incoming of [undefined, "", "qualquer-valor"]) {
    test(`12. sem EVOLUTION_WEBHOOK_SECRET configurado rejeita (header ${incoming === undefined ? "ausente" : JSON.stringify(incoming)})`, async () => {
      delete process.env.EVOLUTION_WEBHOOK_SECRET;
      const req = createMockRequest({
        headers: incoming === undefined ? {} : { "x-evolution-secret": incoming },
        body: { event: "messages.upsert", instance: "inst-1", data: {} },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(rpcCalls).toHaveLength(0);
    });
  }

  test("12b. secret configurado vazio também rejeita", async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "";
    const req = createMockRequest({
      headers: { "x-evolution-secret": "" },
      body: { event: "messages.upsert", instance: "inst-1", data: {} },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(rpcCalls).toHaveLength(0);
  });

  // 13. Comparação em tempo constante sem exceção por tamanhos diferentes
  test("13. validateWebhookSecret compara sem lançar exceção para tamanhos diferentes", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { validateWebhookSecret } = require("@/lib/conversations/webhook");
    expect(validateWebhookSecret("secret_token_123", "secret_token_123")).toBe(true);
    expect(validateWebhookSecret("curto", "secret_token_123")).toBe(false);
    expect(validateWebhookSecret("secret_token_123_mais_longo", "secret_token_123")).toBe(false);
    expect(validateWebhookSecret("secret_token_124", "secret_token_123")).toBe(false);
    expect(validateWebhookSecret(null, "secret_token_123")).toBe(false);
    expect(validateWebhookSecret("secret_token_123", undefined)).toBe(false);
    expect(validateWebhookSecret("", "")).toBe(false);
  });
});
