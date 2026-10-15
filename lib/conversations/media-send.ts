"use server";

import * as serverModule from "@/lib/supabase/server";
import * as adminModule from "@/lib/supabase/admin";
import * as gatewayModule from "@/lib/supabase/gateway";
import * as actionsGateway from "@/lib/supabase/gateway-actions";
import { attachReply, isValidReplyId } from "@/lib/conversations/reply";
import { sendMessageAction } from "@/lib/conversations/actions";
import { classifyGatewayOutcome } from "@/lib/conversations/gateway-outcome";
import { resolveSendInstance } from "@/lib/conversations/send-instance";
import type { ConversationMessage } from "@/lib/conversations/data";
import {
  HEAD_BYTES,
  detectContentFamily,
  MAX_FILE_BYTES,
  FILE_ERROR_MESSAGES,
  mediaLabel,
  mediaTypeFor,
  sanitizeFileName,
  validateOutgoingFile,
  type FileErrorCode,
  type MediaKind,
} from "@/lib/conversations/outgoing-files";

// Envio de arquivos ao cliente. O navegador envia o arquivo DIRETO ao Storage privado (sem passar pela função da
// Vercel); aqui só se autoriza o upload, se confere o que foi guardado (tipo pelo conteúdo, tamanho) e se pede o
// envio à Evolution por uma URL assinada de vida curta. Nada que identifique o arquivo ou a URL vai para log.

const BUCKET = "whatsapp-media";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_REGEX = new RegExp(`^${UUID}$`, "i");
const SIGNED_URL_SECONDS = 600;
const MAX_CAPTION_LENGTH = 1024;

export type MediaFailureCode =
  | FileErrorCode
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "CONVERSATION_NOT_AVAILABLE"
  | "UPLOAD_MISSING"
  | "UPLOAD_ERROR"
  | "CAPTION_TOO_LONG"
  | "QUEUE_ERROR"
  | "NOT_AUTHORIZED"
  | "MEDIA_ALREADY_USED"
  | "PREVIOUSLY_FAILED"
  | "VOICE_TOO_LONG"
  | "FORWARD_SOURCE_UNAVAILABLE"
  | "GROUP_NOT_SUPPORTED"
  | "RETRY_NOT_ALLOWED"
  | "INTERNAL_ERROR"
  | "GATEWAY_NOT_CONFIGURED"
  | "NO_INSTANCE"
  | "WHATSAPP_DISCONNECTED"
  | "EVOLUTION_REJECTED"
  | "GATEWAY_TIMEOUT"
  | "GATEWAY_NETWORK"
  | "INVALID_RECIPIENT"
  | "GATEWAY_ERROR";

export type MediaFailure = { success: false; error: string; code: MediaFailureCode };

const FAILURE_TEXT: Partial<Record<MediaFailureCode, string>> = {
  UNAUTHORIZED: "Sessão expirada ou não autenticada. Entre de novo.",
  INVALID_INPUT: "Os dados do arquivo são inválidos.",
  CONVERSATION_NOT_AVAILABLE: "Esta conversa não está disponível para você.",
  UPLOAD_MISSING: "O arquivo não chegou ao servidor. Anexe de novo.",
  UPLOAD_ERROR: "Não foi possível preparar o envio do arquivo. Tente novamente.",
  CAPTION_TOO_LONG: "A legenda passa de 1024 caracteres.",
  QUEUE_ERROR: "Não foi possível enfileirar o arquivo. Tente novamente.",
  NOT_AUTHORIZED: "Você não tem permissão para enviar nesta conversa.",
  MEDIA_ALREADY_USED: "Este arquivo já foi enviado.",
  PREVIOUSLY_FAILED: "Este envio falhou antes. Use \"Tentar de novo\".",
  VOICE_TOO_LONG: "A gravação passa de 10 minutos.",
  FORWARD_SOURCE_UNAVAILABLE: "Esta mensagem não pode ser encaminhada (foi apagada, escondida ou o arquivo não está disponível).",
  GROUP_NOT_SUPPORTED: "O ImobFlux ainda não envia mensagens para grupos.",
  RETRY_NOT_ALLOWED: "Só dá para tentar de novo um arquivo que falhou ao enviar.",
  INTERNAL_ERROR: "Erro interno ao enviar o arquivo.",
};

const failure = (code: MediaFailureCode, error?: string): MediaFailure => ({
  success: false,
  code,
  error: error ?? FAILURE_TEXT[code] ?? FILE_ERROR_MESSAGES[code as FileErrorCode] ?? "Não foi possível enviar o arquivo.",
});

/** Só o código vai para o log (nunca nome do arquivo, URL assinada, número ou corpo de resposta). */
function logCode(scope: string, code: string) {
  console.error(`Erro em ${scope} (código ${code})`);
}

type ServerClient = Awaited<ReturnType<typeof serverModule.createServerSupabaseClient>>;

async function authorizedConversation(supabase: ServerClient, conversationId: string): Promise<{ workspaceId: string } | MediaFailure> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return failure("UNAUTHORIZED");
  if (!UUID_REGEX.test(conversationId)) return failure("INVALID_INPUT");
  // A RLS de `conversations` só devolve a conversa a quem tem acesso a ela (privacidade de contato/grupo incluída).
  const { data, error } = await supabase.from("conversations").select("id, workspace_id").eq("id", conversationId).maybeSingle();
  if (error || !data) return failure("CONVERSATION_NOT_AVAILABLE");
  return { workspaceId: data.workspace_id };
}

export type PrepareUploadResult =
  | { success: true; path: string; signedUrl: string; token: string }
  | MediaFailure;

/**
 * 1º passo: autoriza UM upload. Confere acesso à conversa e a extensão/tamanho, e devolve uma URL de upload assinada,
 * válida só para o caminho `<workspace>/<conversa>/out/<uuid>` do bucket privado.
 */
export async function prepareOutgoingUploadAction(input: {
  conversationId: string;
  fileName: string;
  size: number;
}): Promise<PrepareUploadResult> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const access = await authorizedConversation(supabase, input.conversationId);
    if ("success" in access) return access;

    const quick = validateOutgoingFile({ fileName: String(input.fileName ?? ""), size: Number(input.size) });
    if (!quick.ok) return failure(quick.code);

    const path = `${access.workspaceId}/${input.conversationId}/out/${crypto.randomUUID()}`;
    const admin = adminModule.createAdminSupabaseClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      logCode("prepareOutgoingUploadAction", "SIGNED_UPLOAD");
      return failure("UPLOAD_ERROR");
    }
    return { success: true, path, signedUrl: data.signedUrl, token: data.token };
  } catch {
    logCode("prepareOutgoingUploadAction", "EXCEPTION");
    return failure("INTERNAL_ERROR");
  }
}

export type SendMediaResult =
  | { success: true; messageId: string; status: "sent" | "duplicate"; message?: ConversationMessage }
  | (MediaFailure & { message?: ConversationMessage });

type Inspected = { size: number; head: Uint8Array };

/** Lê o tamanho e os primeiros bytes do arquivo guardado (por URL assinada, sem baixar o arquivo todo). */
async function inspectStoredObject(admin: ReturnType<typeof adminModule.createAdminSupabaseClient>, path: string): Promise<Inspected | null> {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  try {
    const response = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
    if (!response.ok && response.status !== 206) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    const range = response.headers.get("content-range");
    const total = range ? Number(range.split("/")[1]) : Number(response.headers.get("content-length"));
    const size = Number.isFinite(total) && total > 0 ? total : buffer.length;
    return { size, head: buffer.slice(0, HEAD_BYTES) };
  } catch {
    return null;
  }
}

async function loadMessageWithAttachments(supabase: ServerClient, messageId: string): Promise<ConversationMessage | undefined> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, origin, status, text_content, occurred_at, internal_author_member_id, external_message_id, reply_to_message_id, reply_snapshot, forwarded, edited_at, attachments(id, original_file_name, mime_type, size_bytes, status, created_at)")
    .eq("id", messageId)
    .maybeSingle();
  if (error || !data) return undefined;

  let internalAuthorName: string | null = null;
  if (data.internal_author_member_id) {
    const { data: member } = await supabase.from("workspace_members").select("user_id").eq("id", data.internal_author_member_id).maybeSingle();
    if (member?.user_id) {
      const { data: user } = await supabase.from("app_users").select("display_name").eq("id", member.user_id).maybeSingle();
      internalAuthorName = user?.display_name ?? null;
    }
  }
  const attachments = (data.attachments ?? []).map((attachment) => ({
    id: attachment.id,
    file_name: attachment.original_file_name,
    mime_type: attachment.mime_type,
    size_bytes: Number(attachment.size_bytes),
    status: attachment.status,
    created_at: attachment.created_at,
  }));
  return {
    id: data.id,
    direction: data.direction,
    origin: data.origin,
    status: data.status,
    text_content: data.text_content,
    occurred_at: data.occurred_at,
    has_attachments: attachments.length > 0,
    attachments,
    internal_author_name: internalAuthorName,
    internal_author_member_id: data.internal_author_member_id,
    has_external_id: data.external_message_id !== null,
    reply_to_message_id: data.reply_to_message_id,
    reply_snapshot: (data.reply_snapshot ?? null) as ConversationMessage["reply_snapshot"],
    forwarded: data.forwarded,
    edited_at: data.edited_at,
  };
}

type QueueAndSendInput = {
  supabase: ServerClient;
  conversationId: string;
  path: string;
  fileName: string;
  mime: string;
  size: number;
  kind: MediaKind;
  asDocument: boolean;
  caption: string;
  idempotencyKey: string;
  /** Responder: a mensagem citada. */
  replyToMessageId?: string | null;
  /** Áudio de voz (gravação): sai como mensagem de voz (PTT) pela rota própria da Evolution. */
  voice?: boolean;
};

/** Enfileira a mensagem com o anexo e pede o envio à Evolution; reconcilia o resultado. */
async function queueAndSend(input: QueueAndSendInput): Promise<SendMediaResult> {
  const mediaType = mediaTypeFor(input.kind, input.asDocument);
  const text = input.caption || mediaLabel(mediaType, input.fileName);

  const { data: queueData, error: queueError } = await input.supabase.rpc("queue_outgoing_media_message", {
    p_conversation_id: input.conversationId,
    p_client_idempotency_key: input.idempotencyKey,
    p_storage_key: input.path,
    p_file_name: input.fileName,
    p_mime_type: input.mime,
    p_size_bytes: input.size,
    p_text_content: text,
  });

  if (queueError) {
    logCode("queue_outgoing_media_message", queueError.code ?? "desconhecido");
    if (queueError.code === "42501") return failure("NOT_AUTHORIZED");
    if (queueError.code === "42704") return failure("CONVERSATION_NOT_AVAILABLE");
    if (queueError.code === "23505") return failure("MEDIA_ALREADY_USED");
    return failure("QUEUE_ERROR");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queued = queueData as any;
  if (queued?.status === "duplicate") {
    if (queued.message_status === "failed") return failure("PREVIOUSLY_FAILED");
    const message = await loadMessageWithAttachments(input.supabase, queued.message_id);
    return { success: true, messageId: queued.message_id, status: "duplicate", ...(message ? { message } : {}) };
  }
  if (queued?.status !== "queued" || !queued?.message_id) return failure("QUEUE_ERROR");

  const messageId = queued.message_id as string;
  const admin = adminModule.createAdminSupabaseClient();
  const quoted = await attachReply(input.supabase, messageId, input.replyToMessageId, queued.recipient_target as string | undefined);

  let gatewayResult: Awaited<ReturnType<typeof gatewayModule.sendEvolutionMedia>>;
  const resolved = resolveSendInstance(queued);
  if (!resolved.ok) {
    gatewayResult = { success: false, code: resolved.code, error: "Instância do WhatsApp indisponível" };
  } else {
    const signed = await admin.storage.from(BUCKET).createSignedUrl(input.path, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) {
      gatewayResult = { success: false, code: "SIGNED_URL", error: "Não foi possível preparar o arquivo" };
    } else if (input.voice) {
      gatewayResult = await actionsGateway.sendEvolutionVoiceNote(resolved.instance, queued.recipient_target as string, signed.data.signedUrl, quoted);
    } else {
      gatewayResult = await gatewayModule.sendEvolutionMedia(
        resolved.instance,
        queued.recipient_target as string,
        {
          mediatype: mediaType,
          mimetype: input.mime,
          fileName: input.fileName,
          caption: input.caption || null,
          mediaUrl: signed.data.signedUrl,
        },
        undefined,
        quoted,
      );
    }
  }

  const outcome = classifyGatewayOutcome(gatewayResult);

  if (outcome.deliver) {
    const { error: reconcileError } = await admin.rpc("reconcile_outgoing_text_message", {
      p_message_id: messageId,
      p_target_status: "sent",
      p_external_message_id: gatewayResult.success ? gatewayResult.externalMessageId : undefined,
    });
    if (reconcileError) {
      logCode("reconcile_outgoing_media(sent)", reconcileError.code ?? "desconhecido");
      // 23505: o eco da própria mensagem já ocupa o id externo; marca como enviada sem ele.
      if (reconcileError.code === "23505") {
        await admin.rpc("reconcile_outgoing_text_message", { p_message_id: messageId, p_target_status: "sent", p_external_message_id: undefined });
      }
    }
    const { error: auditError } = await admin.rpc("record_outgoing_media_sent", { p_message_id: messageId, p_media_kind: mediaType });
    if (auditError) logCode("record_outgoing_media_sent", auditError.code ?? "desconhecido");

    const message = await loadMessageWithAttachments(input.supabase, messageId);
    return { success: true, messageId, status: "sent", ...(message ? { message } : {}) };
  }

  logCode("envio de arquivo", `${outcome.code}/${gatewayResult.success ? "-" : (gatewayResult.code ?? "-")}`);
  const { error: reconcileError } = await admin.rpc("reconcile_outgoing_text_message", {
    p_message_id: messageId,
    p_target_status: "failed",
    p_external_message_id: undefined,
  });
  if (reconcileError) logCode("reconcile_outgoing_media(failed)", reconcileError.code ?? "desconhecido");
  const message = await loadMessageWithAttachments(input.supabase, messageId);
  return { ...failure(outcome.code, outcome.error), ...(message ? { message } : {}) };
}

/**
 * 2º passo: depois do upload, confere o arquivo guardado (tipo pelo CONTEÚDO, tamanho real) e envia. Um arquivo
 * recusado é apagado do Storage na hora.
 */
export async function sendOutgoingMediaAction(input: {
  conversationId: string;
  path: string;
  fileName: string;
  caption?: string | null;
  asDocument?: boolean;
  idempotencyKey: string;
  replyToMessageId?: string | null;
}): Promise<SendMediaResult> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const access = await authorizedConversation(supabase, input.conversationId);
    if ("success" in access) return access;

    if (!UUID_REGEX.test(input.idempotencyKey ?? "")) return failure("INVALID_INPUT");
    const expectedPath = new RegExp(`^${access.workspaceId}/${input.conversationId}/out/${UUID}$`, "i");
    if (typeof input.path !== "string" || !expectedPath.test(input.path)) return failure("INVALID_INPUT");

    const caption = (input.caption ?? "").trim();
    if (caption.length > MAX_CAPTION_LENGTH) return failure("CAPTION_TOO_LONG");
    const fileName = sanitizeFileName(String(input.fileName ?? ""));

    const admin = adminModule.createAdminSupabaseClient();
    const inspected = await inspectStoredObject(admin, input.path);
    if (!inspected) return failure("UPLOAD_MISSING");

    const verdict = validateOutgoingFile({ fileName, size: inspected.size, head: inspected.head });
    if (!verdict.ok) {
      await admin.storage.from(BUCKET).remove([input.path]);
      return failure(verdict.code);
    }
    if (inspected.size > MAX_FILE_BYTES) return failure("TOO_LARGE");

    return await queueAndSend({
      supabase,
      conversationId: input.conversationId,
      path: input.path,
      fileName: verdict.fileName,
      mime: verdict.mime,
      size: inspected.size,
      kind: verdict.kind,
      asDocument: Boolean(input.asDocument),
      caption,
      idempotencyKey: input.idempotencyKey,
      replyToMessageId: isValidReplyId(input.replyToMessageId) ? input.replyToMessageId : null,
    });
  } catch {
    logCode("sendOutgoingMediaAction", "EXCEPTION");
    return failure("INTERNAL_ERROR");
  }
}

/**
 * "Tentar de novo" de um arquivo que falhou: nova mensagem (nova chave) com uma CÓPIA do mesmo arquivo no Storage
 * (um arquivo só pode estar em uma mensagem). Só vale para mensagem de saída do CRM que está como "falhou".
 */
export async function retryOutgoingMediaAction(input: { messageId: string; idempotencyKey: string }): Promise<SendMediaResult> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return failure("UNAUTHORIZED");
    if (!UUID_REGEX.test(input.messageId ?? "") || !UUID_REGEX.test(input.idempotencyKey ?? "")) return failure("INVALID_INPUT");

    const { data: failed, error } = await supabase
      .from("messages")
      .select("id, workspace_id, conversation_id, direction, origin, status, text_content, attachments(storage_bucket, storage_key, original_file_name, mime_type, size_bytes)")
      .eq("id", input.messageId)
      .maybeSingle();
    if (error || !failed) return failure("CONVERSATION_NOT_AVAILABLE");
    const attachment = failed.attachments?.[0];
    if (failed.direction !== "outgoing" || failed.origin !== "crm" || failed.status !== "failed" || !attachment || failed.attachments.length !== 1) {
      return failure("RETRY_NOT_ALLOWED");
    }
    const sourcePathRule = new RegExp(`^${failed.workspace_id}/${failed.conversation_id}/out/${UUID}$`, "i");
    if (attachment.storage_bucket !== BUCKET || !sourcePathRule.test(attachment.storage_key)) return failure("RETRY_NOT_ALLOWED");

    const access = await authorizedConversation(supabase, failed.conversation_id);
    if ("success" in access) return access;

    const verdict = validateOutgoingFile({ fileName: attachment.original_file_name, size: Number(attachment.size_bytes) });
    if (!verdict.ok) return failure(verdict.code);

    const newPath = `${access.workspaceId}/${failed.conversation_id}/out/${crypto.randomUUID()}`;
    const admin = adminModule.createAdminSupabaseClient();
    const { error: copyError } = await admin.storage.from(BUCKET).copy(attachment.storage_key, newPath);
    if (copyError) {
      logCode("retryOutgoingMediaAction", "COPY");
      return failure("UPLOAD_ERROR");
    }

    // Se o texto da mensagem é só o rótulo gerado, não havia legenda.
    const text = (failed.text_content ?? "").trim();
    const generated = [mediaLabel(verdict.kind, verdict.fileName), mediaLabel("document", verdict.fileName)];
    const caption = generated.includes(text) ? "" : text;

    return await queueAndSend({
      supabase,
      conversationId: failed.conversation_id,
      path: newPath,
      fileName: verdict.fileName,
      mime: attachment.mime_type || verdict.mime,
      size: Number(attachment.size_bytes),
      kind: verdict.kind,
      // O rótulo de documento numa imagem indica que ela tinha sido enviada "como documento": mantém.
      asDocument: verdict.kind === "image" && text === mediaLabel("document", verdict.fileName),
      caption,
      idempotencyKey: input.idempotencyKey,
    });
  } catch {
    logCode("retryOutgoingMediaAction", "EXCEPTION");
    return failure("INTERNAL_ERROR");
  }
}

/** A pessoa tirou o arquivo da bandeja antes de enviar: apaga o upload (só se ele ainda não virou mensagem). */
export async function discardOutgoingUploadAction(input: { conversationId: string; path: string }): Promise<{ success: boolean }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const access = await authorizedConversation(supabase, input.conversationId);
    if ("success" in access) return { success: false };
    const expectedPath = new RegExp(`^${access.workspaceId}/${input.conversationId}/out/${UUID}$`, "i");
    if (typeof input.path !== "string" || !expectedPath.test(input.path)) return { success: false };

    const { data: used } = await supabase.from("attachments").select("id").eq("storage_key", input.path).limit(1);
    if (used && used.length > 0) return { success: false };

    const admin = adminModule.createAdminSupabaseClient();
    const { error } = await admin.storage.from(BUCKET).remove([input.path]);
    return { success: !error };
  } catch {
    logCode("discardOutgoingUploadAction", "EXCEPTION");
    return { success: false };
  }
}

// ─── Áudio de voz (gravado no navegador) ──────────────────────────────────────────────────────────

/** Duração máxima de uma gravação de voz, em segundos (10 minutos). */
const MAX_VOICE_SECONDS = 600;

const VOICE_FAMILIES: Record<string, { ext: string; mime: string }> = {
  webm: { ext: "webm", mime: "audio/webm" },
  ogg: { ext: "ogg", mime: "audio/ogg" },
  mp4: { ext: "m4a", mime: "audio/mp4" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  wav: { ext: "wav", mime: "audio/wav" },
  aac: { ext: "aac", mime: "audio/aac" },
  amr: { ext: "amr", mime: "audio/amr" },
  flac: { ext: "flac", mime: "audio/flac" },
};

/**
 * Envia uma gravação de voz como mensagem de voz (PTT). O navegador sobe o áudio direto ao Storage (mesma URL de upload
 * dos arquivos); aqui o tipo é conferido pelo CONTEÚDO, o limite de 10 min / 25 MB é aplicado e o envio usa a rota de áudio
 * de voz da Evolution (que converte para ogg/opus). Sem transcrição.
 */
export async function sendVoiceNoteAction(input: {
  conversationId: string;
  path: string;
  durationSeconds: number;
  idempotencyKey: string;
  replyToMessageId?: string | null;
}): Promise<SendMediaResult> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const access = await authorizedConversation(supabase, input.conversationId);
    if ("success" in access) return access;
    if (!UUID_REGEX.test(input.idempotencyKey ?? "")) return failure("INVALID_INPUT");
    const expectedPath = new RegExp(`^${access.workspaceId}/${input.conversationId}/out/${UUID}$`, "i");
    if (typeof input.path !== "string" || !expectedPath.test(input.path)) return failure("INVALID_INPUT");
    if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return failure("INVALID_INPUT");
    if (input.durationSeconds > MAX_VOICE_SECONDS + 5) return failure("VOICE_TOO_LONG");

    const admin = adminModule.createAdminSupabaseClient();
    const inspected = await inspectStoredObject(admin, input.path);
    if (!inspected) return failure("UPLOAD_MISSING");
    if (inspected.size > MAX_FILE_BYTES) {
      await admin.storage.from(BUCKET).remove([input.path]);
      return failure("TOO_LARGE");
    }
    const voice = VOICE_FAMILIES[detectContentFamily(inspected.head)];
    if (!voice) {
      await admin.storage.from(BUCKET).remove([input.path]);
      return failure("CONTENT_MISMATCH");
    }

    return await queueAndSend({
      supabase,
      conversationId: input.conversationId,
      path: input.path,
      fileName: `voz.${voice.ext}`,
      mime: voice.mime,
      size: inspected.size,
      kind: "audio",
      asDocument: false,
      caption: "",
      idempotencyKey: input.idempotencyKey,
      replyToMessageId: isValidReplyId(input.replyToMessageId) ? input.replyToMessageId : null,
      voice: true,
    });
  } catch {
    logCode("sendVoiceNoteAction", "EXCEPTION");
    return failure("INTERNAL_ERROR");
  }
}

// ─── Encaminhar ───────────────────────────────────────────────────────────────────────────────────

/**
 * Encaminha UMA mensagem (texto ou arquivo) para UMA conversa. O navegador chama uma vez por destino, cada uma na fila
 * da conversa de destino, então a falha de um destino não cancela os outros. O banco confere que a pessoa vê a mensagem
 * de origem e a conversa de destino (RLS e `can_access_conversation`); arquivo é COPIADO no Storage (reaproveita o que já
 * está salvo, sem baixar de novo). Só conversas individuais: o envio a grupos ainda não existe no ImobFlux.
 */
export async function forwardMessageToConversationAction(input: {
  sourceMessageId: string;
  targetConversationId: string;
  idempotencyKey: string;
}): Promise<SendMediaResult> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return failure("UNAUTHORIZED");
    if (
      !UUID_REGEX.test(input.sourceMessageId ?? "")
      || !UUID_REGEX.test(input.targetConversationId ?? "")
      || !UUID_REGEX.test(input.idempotencyKey ?? "")
    ) return failure("INVALID_INPUT");

    const { data: source, error: sourceError } = await supabase.rpc("get_message_for_forward", { p_message_id: input.sourceMessageId });
    if (sourceError || !source) return failure("FORWARD_SOURCE_UNAVAILABLE");
    const info = source as unknown as {
      text: string | null;
      attachments: Array<{ file_name: string; mime_type: string; size_bytes: number; storage_bucket: string; storage_key: string; status: string }>;
    };

    const access = await authorizedConversation(supabase, input.targetConversationId);
    if ("success" in access) return access;
    const { data: target } = await supabase
      .from("conversations")
      .select("conversation_type, operational_status")
      .eq("id", input.targetConversationId)
      .maybeSingle();
    if (!target || !["active", "archived"].includes(target.operational_status)) return failure("CONVERSATION_NOT_AVAILABLE");
    if (target.conversation_type !== "individual") return failure("GROUP_NOT_SUPPORTED");

    let result: SendMediaResult;
    const attachment = info.attachments?.[0];
    if (!attachment) {
      const text = (info.text ?? "").trim();
      if (!text) return failure("FORWARD_SOURCE_UNAVAILABLE");
      const sent = await sendMessageAction(input.targetConversationId, text, input.idempotencyKey);
      result = sent.success
        ? { success: true, messageId: sent.messageId, status: sent.status === "sent" ? "sent" : "duplicate", ...(sent.message ? { message: sent.message } : {}) }
        : failure((sent.code as MediaFailureCode) ?? "GATEWAY_ERROR", sent.error);
    } else {
      if (attachment.status !== "available" || attachment.storage_bucket !== BUCKET) return failure("FORWARD_SOURCE_UNAVAILABLE");
      const verdict = validateOutgoingFile({ fileName: attachment.file_name, size: Number(attachment.size_bytes) });
      if (!verdict.ok) return failure(verdict.code);

      const newPath = `${access.workspaceId}/${input.targetConversationId}/out/${crypto.randomUUID()}`;
      const admin = adminModule.createAdminSupabaseClient();
      const { error: copyError } = await admin.storage.from(BUCKET).copy(attachment.storage_key, newPath);
      if (copyError) {
        logCode("forwardMessageToConversationAction", "COPY");
        return failure("UPLOAD_ERROR");
      }
      const text = (info.text ?? "").trim();
      const generated = [mediaLabel(verdict.kind, verdict.fileName), mediaLabel("document", verdict.fileName)];
      result = await queueAndSend({
        supabase,
        conversationId: input.targetConversationId,
        path: newPath,
        fileName: verdict.fileName,
        mime: attachment.mime_type || verdict.mime,
        size: Number(attachment.size_bytes),
        kind: verdict.kind,
        asDocument: verdict.kind === "image" && text === mediaLabel("document", verdict.fileName),
        caption: generated.includes(text) ? "" : text,
        idempotencyKey: input.idempotencyKey,
      });
    }

    if (result.success && result.status !== "duplicate") {
      const { error: markError } = await supabase.rpc("mark_message_forwarded", {
        p_message_id: result.messageId,
        p_source_message_id: input.sourceMessageId,
      });
      if (markError) logCode("mark_message_forwarded", markError.code ?? "desconhecido");
      else if (result.message) result = { ...result, message: { ...result.message, forwarded: true } };
    }
    return result;
  } catch {
    logCode("forwardMessageToConversationAction", "EXCEPTION");
    return failure("INTERNAL_ERROR");
  }
}
