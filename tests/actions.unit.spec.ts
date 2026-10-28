import "./helpers/server-only";

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverSupabaseModule = require("@/lib/supabase/server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminSupabaseModule = require("@/lib/supabase/admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gatewayModule = require("@/lib/supabase/gateway");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextCacheModule = require("next/cache");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/conversations/actions");
const sendMessageAction = actionsModule.sendMessageAction;

const originalCreateServerSupabaseClient = serverSupabaseModule.createServerSupabaseClient;
const originalCreateAdminSupabaseClient = adminSupabaseModule.createAdminSupabaseClient;
const originalSendEvolutionTextMessage = gatewayModule.sendEvolutionTextMessage;

const VALID_CONVERSATION_ID = "21000000-0000-4000-8000-000000000099";
const VALID_IDEMPOTENCY_KEY = "77000000-0000-4000-8000-000000000001";

test.describe("Server Action sendMessageAction Unit Tests", () => {
  let authUserResult: { data: unknown; error: unknown } = {
    data: { user: { id: "user-123" } },
    error: null,
  };
  let queueRpcResult: { data: unknown; error: unknown } = {
    data: {
      status: "queued",
      message_id: "msg-uuid-999",
      recipient_target: "+5582999990099",
    },
    error: null,
  };
  let gatewayResult: { success: boolean; externalMessageId?: string; error?: string; code?: string } = {
    success: true,
    externalMessageId: "ext-msg-123",
  };
  let reconcileCalls: Array<{ fnName: string; args: Record<string, unknown> }> = [];
  let reconcileRpcResult: { data: unknown; error: unknown } = {
    data: { status: "success" },
    error: null,
  };
  let revalidatedPaths: string[] = [];
  let gatewayCalledCount = 0;

  test.beforeEach(() => {
    Object.assign(process.env, {
      EVOLUTION_API_URL: "http://localhost:8080",
      EVOLUTION_API_KEY: "secret_key_123",
      EVOLUTION_INSTANCE_NAME: "instance_test_99",
    });

    authUserResult = {
      data: { user: { id: "user-123" } },
      error: null,
    };
    queueRpcResult = {
      data: {
        status: "queued",
        message_id: "msg-uuid-999",
        recipient_target: "+5582999990099",
      },
      error: null,
    };
    gatewayResult = {
      success: true,
      externalMessageId: "ext-msg-123",
    };
    reconcileCalls = [];
    reconcileRpcResult = {
      data: { status: "success" },
      error: null,
    };
    revalidatedPaths = [];
    gatewayCalledCount = 0;

    // Mock do client autenticado
    serverSupabaseModule.createServerSupabaseClient = async () => {
      return {
        auth: {
          getUser: async () => authUserResult,
        },
        rpc: async (fnName: string) => {
          if (fnName === "queue_outgoing_text_message") {
            return queueRpcResult;
          }
          return { data: null, error: null };
        },
      };
    };

    // Mock do client admin
    adminSupabaseModule.createAdminSupabaseClient = () => {
      return {
        rpc: async (fnName: string, args: Record<string, unknown>) => {
          reconcileCalls.push({ fnName, args });
          return reconcileRpcResult;
        },
      };
    };

    // Mock do gateway
    gatewayModule.sendEvolutionTextMessage = async () => {
      gatewayCalledCount++;
      return gatewayResult;
    };

    // Mock do revalidatePath
    nextCacheModule.revalidatePath = (path: string) => {
      revalidatedPaths.push(path);
    };
  });

  test.afterEach(() => {
    serverSupabaseModule.createServerSupabaseClient = originalCreateServerSupabaseClient;
    adminSupabaseModule.createAdminSupabaseClient = originalCreateAdminSupabaseClient;
    gatewayModule.sendEvolutionTextMessage = originalSendEvolutionTextMessage;
  });

  test("1. sessão não autenticada/expirada retorna erro UNAUTHORIZED", async () => {
    authUserResult = { data: null, error: { message: "No session" } };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Sessão expirada ou não autenticada",
      code: "UNAUTHORIZED",
    });
  });

  test("2. conversationId inválido retorna erro INVALID_CONVERSATION_ID", async () => {
    const res = await sendMessageAction(
      "invalid-uuid",
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "ID da conversa inválido",
      code: "INVALID_CONVERSATION_ID",
    });
  });

  test("3. clientIdempotencyKey inválida retorna erro INVALID_IDEMPOTENCY_KEY", async () => {
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      "invalid-uuid",
    );

    expect(res).toEqual({
      success: false,
      error: "Chave de idempotência inválida",
      code: "INVALID_IDEMPOTENCY_KEY",
    });
  });

  test("4. conteúdo vazio retorna erro EMPTY_TEXT", async () => {
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "   ",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Conteúdo da mensagem não pode ser vazio",
      code: "EMPTY_TEXT",
    });
  });

  test("5. conteúdo excedendo 4096 caracteres retorna erro TEXT_TOO_LONG", async () => {
    const longText = "a".repeat(4097);
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      longText,
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error:
        "Conteúdo da mensagem excede o limite máximo permitido de 4096 caracteres",
      code: "TEXT_TOO_LONG",
    });
  });

  test("6. falha ao enfileirar via RPC retorna erro QUEUE_ERROR", async () => {
    queueRpcResult = { data: null, error: { message: "DB Error" } };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Erro ao enfileirar mensagem de saída",
      code: "QUEUE_ERROR",
    });
  });

  test("7. duplicate com status sent retorna sucesso idempotente sem chamar gateway", async () => {
    queueRpcResult = {
      data: {
        status: "duplicate",
        message_id: "msg-uuid-999",
        message_status: "sent",
      },
      error: null,
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: true,
      messageId: "msg-uuid-999",
      status: "duplicate",
    });
    expect(gatewayCalledCount).toBe(0);
    expect(revalidateCalls.length).toBe(0);
    // o envio não revalida rotas: a tela atualiza sozinha e a revalidação re-renderizaria a lista inteira
    expect(revalidatedPaths).toEqual([]);
  });

  test("8. duplicate com status queued retorna sucesso idempotente em fila", async () => {
    queueRpcResult = {
      data: {
        status: "duplicate",
        message_id: "msg-uuid-999",
        message_status: "queued",
      },
      error: null,
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: true,
      messageId: "msg-uuid-999",
      status: "duplicate",
    });
    expect(gatewayCalledCount).toBe(0);
    // o envio não revalida rotas: a tela atualiza sozinha e a revalidação re-renderizaria a lista inteira
    expect(revalidatedPaths).toEqual([]);
  });

  test("9. duplicate com status failed indica erro anterior sem retry automático", async () => {
    queueRpcResult = {
      data: {
        status: "duplicate",
        message_id: "msg-uuid-999",
        message_status: "failed",
      },
      error: null,
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "Esta mensagem falhou em uma tentativa anterior de envio.",
      code: "PREVIOUSLY_FAILED",
    });
    expect(gatewayCalledCount).toBe(0);
  });

  test("10. fluxo com sucesso no gateway chama reconcile com sent (sem revalidar rotas)", async () => {
    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: true,
      messageId: "msg-uuid-999",
      status: "sent",
    });
    expect(gatewayCalledCount).toBe(1);
    expect(reconcileCalls.length).toBe(1);
    expect(reconcileCalls[0]).toEqual({
      fnName: "reconcile_outgoing_text_message",
      args: {
        p_message_id: "msg-uuid-999",
        p_target_status: "sent",
        p_external_message_id: "ext-msg-123",
      },
    });
    // o envio não revalida rotas: a tela atualiza sozinha e a revalidação re-renderizaria a lista inteira
    expect(revalidatedPaths).toEqual([]);
  });

  test("11. fluxo com falha no gateway chama reconcile com failed e omite segredos", async () => {
    gatewayResult = {
      success: false,
      error: "HTTP 500",
      code: "HTTP_500",
    };

    const res = await sendMessageAction(
      VALID_CONVERSATION_ID,
      "Olá, mundo",
      VALID_IDEMPOTENCY_KEY,
    );

    expect(res).toEqual({
      success: false,
      error: "O WhatsApp recusou o envio (código HTTP_500). A mensagem não foi enviada. Se continuar, avise o responsável técnico com este código.",
      code: "EVOLUTION_REJECTED",
    });
    expect(gatewayCalledCount).toBe(1);
    expect(reconcileCalls.length).toBe(1);
    expect(reconcileCalls[0]).toEqual({
      fnName: "reconcile_outgoing_text_message",
      args: {
        p_message_id: "msg-uuid-999",
        p_target_status: "failed",
        p_external_message_id: undefined,
      },
    });
    // o envio não revalida rotas: a tela atualiza sozinha e a revalidação re-renderizaria a lista inteira
    expect(revalidatedPaths).toEqual([]);
  });

  test.describe("12. status 'enviada' só com aceite real do gateway", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
    test.afterEach(() => {
      Object.assign(process.env, { NODE_ENV: originalNodeEnv });
      if (originalDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
      else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemo;
    });

    const notConfigured = { success: false, error: "Configuração da Evolution API ausente no ambiente", code: "MISSING_ENV_CONFIG" };

    test("produção sem WhatsApp configurado: falha, grava 'failed' e nunca 'sent'", async () => {
      Object.assign(process.env, { NODE_ENV: "production" });
      gatewayResult = notConfigured;

      const res = await sendMessageAction(VALID_CONVERSATION_ID, "Olá", VALID_IDEMPOTENCY_KEY);

      expect(res).toEqual({
        success: false,
        error: "A integração com o WhatsApp não está configurada neste ambiente (servidor da Evolution). A mensagem não foi enviada.",
        code: "GATEWAY_NOT_CONFIGURED",
      });
      expect(reconcileCalls.map((call) => call.args.p_target_status)).toEqual(["failed"]);
    });

    test("produção ignora NEXT_PUBLIC_DEMO_MODE=true (não existe contorno em produção)", async () => {
      Object.assign(process.env, { NODE_ENV: "production", NEXT_PUBLIC_DEMO_MODE: "true" });
      gatewayResult = notConfigured;

      const res = await sendMessageAction(VALID_CONVERSATION_ID, "Olá", VALID_IDEMPOTENCY_KEY);

      expect(res.success).toBe(false);
      expect(reconcileCalls.map((call) => call.args.p_target_status)).toEqual(["failed"]);
    });

    test("desenvolvimento: falha REAL do gateway (HTTP/timeout) continua falha", async () => {
      Object.assign(process.env, { NODE_ENV: "development" });
      for (const code of ["HTTP_500", "TIMEOUT", "NETWORK_ERROR"]) {
        reconcileCalls = [];
        gatewayResult = { success: false, error: "falha real", code };
        const res = await sendMessageAction(VALID_CONVERSATION_ID, "Olá", VALID_IDEMPOTENCY_KEY);
        expect(res.success).toBe(false);
        expect(reconcileCalls.map((call) => call.args.p_target_status)).toEqual(["failed"]);
      }
    });

    test("desenvolvimento sem WhatsApp configurado mantém o contorno local (sem gateway)", async () => {
      Object.assign(process.env, { NODE_ENV: "development" });
      gatewayResult = notConfigured;

      const res = await sendMessageAction(VALID_CONVERSATION_ID, "Olá", VALID_IDEMPOTENCY_KEY);

      expect(res.success).toBe(true);
      expect(reconcileCalls.map((call) => call.args.p_target_status)).toEqual(["sent"]);
      expect(reconcileCalls[0].args.p_external_message_id).toBeUndefined();
    });
  });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mediaDownloadModule = require("@/lib/conversations/media-download");
const retryAttachmentDownloadAction = actionsModule.retryAttachmentDownloadAction;
const originalLoadMediaSource = mediaDownloadModule.loadMediaSource;
const originalStoreAttachmentMedia = mediaDownloadModule.storeAttachmentMedia;

test.describe("retryAttachmentDownloadAction", () => {
  const ATTACHMENT_ID = "d3b0b8a2-6f5e-4c1a-9e57-0c1f2a9b7e11";
  let user: { id: string } | null;
  let attachmentRow: { id: string; status: string; created_at: string; size_bytes?: number } | null;
  let source: unknown;
  let storeResult: { status: string; code?: string };
  let storeCalls: string[];
  let loadCalls: number;

  test.beforeEach(() => {
    user = { id: "u1" };
    attachmentRow = { id: ATTACHMENT_ID, status: "unavailable", created_at: new Date(Date.now() - 3_600_000).toISOString() };
    source = { instance: "inst", key: { id: "EXT" } };
    storeResult = { status: "available" };
    storeCalls = [];
    loadCalls = 0;
    serverSupabaseModule.createServerSupabaseClient = async () => ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: attachmentRow, error: null }) }) }) }),
    });
    adminSupabaseModule.createAdminSupabaseClient = () => ({});
    mediaDownloadModule.loadMediaSource = async () => { loadCalls++; return source; };
    mediaDownloadModule.storeAttachmentMedia = async (_admin: unknown, id: string) => { storeCalls.push(id); return storeResult; };
  });

  test.afterEach(() => {
    serverSupabaseModule.createServerSupabaseClient = originalCreateServerSupabaseClient;
    adminSupabaseModule.createAdminSupabaseClient = originalCreateAdminSupabaseClient;
    mediaDownloadModule.loadMediaSource = originalLoadMediaSource;
    mediaDownloadModule.storeAttachmentMedia = originalStoreAttachmentMedia;
  });

  test("anexo indisponível: baixa de novo e confirma", async () => {
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({ success: true });
    expect(storeCalls).toEqual([ATTACHMENT_ID]);
  });

  test("arquivo acima do limite: recusa com o motivo, sem chamar a Evolution", async () => {
    attachmentRow = { ...attachmentRow!, size_bytes: 60 * 1024 * 1024 };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({ success: false, error: "O arquivo é maior que o limite de 50 MB. Abra no WhatsApp para vê-lo." });
    expect(loadCalls).toBe(0);
    expect(storeCalls).toHaveLength(0);
  });

  test("valida identificador e sessão antes de qualquer chamada externa", async () => {
    expect(await retryAttachmentDownloadAction("nao-uuid")).toEqual({ success: false, error: "Anexo inválido." });
    user = null;
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toMatchObject({ success: false });
    expect(loadCalls).toBe(0);
    expect(storeCalls).toHaveLength(0);
  });

  test("anexo que a RLS esconde (privacidade) não chega à Evolution", async () => {
    attachmentRow = null;
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({ success: false, error: "Anexo não encontrado." });
    expect(loadCalls).toBe(0);
    expect(storeCalls).toHaveLength(0);
  });

  test("já disponível: sucesso sem nova chamada; arquivado: recusa", async () => {
    attachmentRow = { ...attachmentRow!, status: "available" };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({ success: true });
    attachmentRow = { ...attachmentRow, status: "archived" };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toMatchObject({ success: false });
    expect(storeCalls).toHaveLength(0);
  });

  test("download em andamento (pending recente) não dispara tentativa simultânea; pending antigo sim", async () => {
    attachmentRow = { ...attachmentRow!, status: "pending", created_at: new Date().toISOString() };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({ success: false, error: "O arquivo já está sendo carregado." });
    expect(storeCalls).toHaveLength(0);

    attachmentRow = { ...attachmentRow, created_at: new Date(Date.now() - 3_600_000).toISOString() };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({ success: true });
  });

  test("sem origem na conexão: erro claro, sem chamar o download", async () => {
    source = null;
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toMatchObject({ success: false });
    expect(storeCalls).toHaveLength(0);
  });

  test("Evolution fora do ar: erro amigável, sem lançar", async () => {
    storeResult = { status: "failed", code: "NETWORK_ERROR" };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({
      success: false,
      error: "Não foi possível falar com o WhatsApp agora. Tente novamente em instantes.",
    });
    storeResult = { status: "failed", code: "NOT_FOUND" };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toMatchObject({ success: false, error: expect.stringContaining("não tem mais este arquivo") });
  });

  test("erro inesperado vira mensagem genérica, nunca exceção", async () => {
    mediaDownloadModule.storeAttachmentMedia = async () => { throw new Error("boom"); };
    expect(await retryAttachmentDownloadAction(ATTACHMENT_ID)).toEqual({ success: false, error: "Não foi possível carregar o arquivo agora." });
  });
});

const revalidateCalls: unknown[] = [];
