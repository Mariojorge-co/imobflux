"use server";

import { revalidatePath } from "next/cache";
import {
  getConversationsList,
  getConversationsInbox,
  getConversationMessages,
  getVisibleInternalNotes,
} from "@/lib/conversations/data";
import type {
  ConversationContextData,
  ConversationListItem,
  ConversationMessage,
  ConversationMessagesPage,
  ConversationInboxPage,
  ConversationInboxView,
  ConversationsCursor,
  MessagesCursor,
  NewConversationCandidate,
} from "@/lib/conversations/data";
import {
  looksLikePhoneSearch,
  normalizeBrazilianPhone,
} from "@/lib/contacts/phone";
import * as serverModule from "@/lib/supabase/server";
import * as adminModule from "@/lib/supabase/admin";
import * as gatewayModule from "@/lib/supabase/gateway";
import { resolveSendInstance } from "@/lib/conversations/send-instance";
import { classifyGatewayOutcome } from "@/lib/conversations/gateway-outcome";
import { assignmentErrorMessage } from "@/lib/conversations/assignment";
import { attachReply } from "@/lib/conversations/reply";
import { taskErrorMessage } from "@/lib/tasks/model";
import * as mediaModule from "@/lib/conversations/media-download";
import { isDownloadInProgress, isMediaTooLarge, MAX_MEDIA_LABEL } from "@/lib/conversations/media-types";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_TEXT_LENGTH = 4096;

export type SendMessageResult =
  | {
      success: true;
      messageId: string;
      status: "sent" | "queued" | "duplicate";
      message?: ConversationMessage;
    }
  | { success: false; error: string; code?: string };

async function getPersistedMessage(
  supabase: Awaited<ReturnType<typeof serverModule.createServerSupabaseClient>>,
  messageId: string,
): Promise<ConversationMessage | undefined> {
  if (typeof supabase.from !== "function") return undefined;

  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, origin, status, text_content, occurred_at, internal_author_member_id, external_message_id, reply_to_message_id, reply_snapshot, forwarded, edited_at")
    .eq("id", messageId)
    .maybeSingle();

  if (error || !data) return undefined;

  let internalAuthorName: string | null = null;
  if (data.internal_author_member_id) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("id", data.internal_author_member_id)
      .maybeSingle();
    if (member?.user_id) {
      const { data: user } = await supabase
        .from("app_users")
        .select("display_name")
        .eq("id", member.user_id)
        .maybeSingle();
      internalAuthorName = user?.display_name ?? null;
    }
  }

  return {
    id: data.id,
    direction: data.direction,
    origin: data.origin,
    status: data.status,
    text_content: data.text_content,
    occurred_at: data.occurred_at,
    has_attachments: false,
    internal_author_name: internalAuthorName,
    internal_author_member_id: data.internal_author_member_id,
    has_external_id: data.external_message_id !== null,
    reply_to_message_id: data.reply_to_message_id,
    reply_snapshot: (data.reply_snapshot ?? null) as ConversationMessage["reply_snapshot"],
    forwarded: data.forwarded,
    edited_at: data.edited_at,
  };
}

/**
 * Server Action: pesquisa ou carrega mais conversas.
 */
export async function searchConversationsAction(
  search: string,
  cursor: ConversationsCursor | undefined,
  view: ConversationInboxView = "all",
): Promise<ConversationListItem[]> {
  return getConversationsList({ search: search || undefined, cursor, view });
}

export async function refreshConversationsInboxAction(
  search: string,
  view: ConversationInboxView,
): Promise<ConversationInboxPage> {
  return getConversationsInbox({ search: search || undefined, view, limit: 20 });
}

export async function searchNewConversationCandidatesAction(
  query: string,
): Promise<{
  candidates: NewConversationCandidate[];
  normalizedPhone: string | null;
}> {
  const search = query.trim();
  const normalized = looksLikePhoneSearch(search)
    ? normalizeBrazilianPhone(search)
    : null;

  if ((!normalized && search.length < 2) || search.length > 120) {
    return { candidates: [], normalizedPhone: null };
  }

  const supabase = await serverModule.createServerSupabaseClient();
  const conversations = (await getConversationsList({
    search: normalized?.normalizedValue ?? search,
    limit: 20,
  })).filter((conversation) => conversation.conversation_type === "individual");

  let contactIds: string[] = [];
  if (normalized) {
    const { data: points } = await supabase
      .from("contact_points")
      .select("contact_id")
      .eq("point_type", "phone")
      .eq("operational_status", "active")
      .eq("normalized_value", normalized.normalizedValue);
    contactIds = (points ?? [])
      .map((point) => point.contact_id)
      .filter((contactId): contactId is string => Boolean(contactId));
  } else {
    const escaped = search.replaceAll("%", "\\%").replaceAll("_", "\\_");
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id")
      .ilike("display_name", `%${escaped}%`)
      .eq("operational_status", "active")
      .is("archived_at", null)
      .limit(10);
    contactIds = (contacts ?? []).map((contact) => contact.id);
  }

  const { data: contacts } = contactIds.length > 0
    ? await supabase
        .from("contacts")
        .select("id, display_name")
        .in("id", [...new Set(contactIds)])
    : { data: [] };
  const { data: points } = contactIds.length > 0
    ? await supabase
        .from("contact_points")
        .select("contact_id, display_value")
        .in("contact_id", [...new Set(contactIds)])
        .eq("point_type", "phone")
        .eq("operational_status", "active")
    : { data: [] };

  const authorizedConversations = contactIds.length > 0
    ? await getConversationsList({ limit: 100 })
    : conversations;

  const conversationByContact = new Map(
    authorizedConversations
      .filter((conversation) => conversation.contact_id)
      .map((conversation) => [conversation.contact_id as string, conversation]),
  );
  const phoneByContact = new Map(
    (points ?? []).map((point) => [point.contact_id, point.display_value]),
  );
  const candidates = new Map<string, NewConversationCandidate>();

  for (const contact of contacts ?? []) {
    const conversation = conversationByContact.get(contact.id);
    candidates.set(`contact:${contact.id}`, {
      contactId: contact.id,
      conversationId: conversation?.conversation_id ?? null,
      displayName: contact.display_name,
      phone: phoneByContact.get(contact.id) ?? null,
    });
  }
  for (const conversation of conversations) {
    const key = conversation.contact_id
      ? `contact:${conversation.contact_id}`
      : `conversation:${conversation.conversation_id}`;
    if (!candidates.has(key)) {
      candidates.set(key, {
        contactId: conversation.contact_id ?? null,
        conversationId: conversation.conversation_id,
        displayName: conversation.participant_name ?? "Contato",
        phone: conversation.participant_phone ?? null,
      });
    }
  }

  return {
    candidates: [...candidates.values()].slice(0, 10),
    normalizedPhone: normalized?.normalizedValue ?? null,
  };
}

export async function setConversationArchivedAction(
  conversationId: string,
  archived: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await supabase.rpc("set_conversation_archived", {
      p_conversation_id: conversationId,
      p_archived: archived,
    });
    if (error) return { success: false, error: error.message };
    revalidatePath("/conversas");
    if (!archived) revalidatePath(`/conversas/${conversationId}`);
    return { success: true };
  } catch (error) {
    console.error("Erro ao alterar arquivamento da conversa:", error);
    return { success: false, error: "Falha ao alterar arquivamento." };
  }
}

export async function startIndividualConversationAction(
  phone: string,
): Promise<{ success: true; conversationId: string } | { success: false; error: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data, error } = await supabase.rpc("resolve_or_start_individual_conversation", {
      p_phone: phone,
    });
    const result = data as { conversation_id?: string } | null;
    if (error || !result?.conversation_id) {
      return { success: false, error: "Não foi possível iniciar uma conversa com este número." };
    }
    revalidatePath("/conversas");
    return { success: true, conversationId: result.conversation_id };
  } catch {
    return { success: false, error: "Não foi possível iniciar uma conversa com este número." };
  }
}

export async function setGroupTeamVisibilityAction(
  conversationId: string,
  teamVisible: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await supabase.rpc("set_group_team_visibility", {
      p_conversation_id: conversationId,
      p_team_visible: teamVisible,
    });
    if (error) return { success: false, error: error.message };
    revalidatePath("/conversas");
    revalidatePath(`/conversas/${conversationId}`);
    return { success: true };
  } catch {
    return { success: false, error: "Falha ao alterar privacidade do grupo." };
  }
}

/**
 * Server Action: carrega mensagens anteriores de uma conversa.
 */
export async function loadMoreMessagesAction(
  conversationId: string,
  cursor: MessagesCursor,
): Promise<ConversationMessagesPage> {
  return getConversationMessages(conversationId, cursor);
}

export async function refreshConversationMessagesAction(
  conversationId: string,
): Promise<ConversationMessagesPage> {
  return getConversationMessages(conversationId);
}

export async function refreshVisibleInternalNotesAction(
  conversationId: string,
  opportunityId?: string | null,
): Promise<ConversationContextData["notes"]> {
  return getVisibleInternalNotes(conversationId, opportunityId);
}

/**
 * Server Action: envia uma mensagem de texto pelo CRM no contexto da conversa informada.
 */
export async function sendMessageAction(
  conversationId: string,
  textContent: string,
  clientIdempotencyKey: string,
  replyToMessageId?: string | null,
): Promise<SendMessageResult> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return {
        success: false,
        error: "Sessão expirada ou não autenticada",
        code: "UNAUTHORIZED",
      };
    }

    if (!conversationId || !UUID_REGEX.test(conversationId)) {
      return {
        success: false,
        error: "ID da conversa inválido",
        code: "INVALID_CONVERSATION_ID",
      };
    }

    if (!clientIdempotencyKey || !UUID_REGEX.test(clientIdempotencyKey)) {
      return {
        success: false,
        error: "Chave de idempotência inválida",
        code: "INVALID_IDEMPOTENCY_KEY",
      };
    }

    const trimmedText = textContent?.trim();
    if (!trimmedText) {
      return {
        success: false,
        error: "Conteúdo da mensagem não pode ser vazio",
        code: "EMPTY_TEXT",
      };
    }

    if (textContent.length > MAX_MESSAGE_TEXT_LENGTH) {
      return {
        success: false,
        error: "Conteúdo da mensagem excede o limite máximo permitido de 4096 caracteres",
        code: "TEXT_TOO_LONG",
      };
    }

    const { data: queueData, error: queueError } = await supabase.rpc(
      "queue_outgoing_text_message",
      {
        p_conversation_id: conversationId,
        p_text_content: textContent,
        p_client_idempotency_key: clientIdempotencyKey,
      },
    );

    if (queueError) {
      console.error("Erro na RPC queue_outgoing_text_message:", queueError);
      return {
        success: false,
        error: "Erro ao enfileirar mensagem de saída",
        code: "QUEUE_ERROR",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueObj = queueData as any;

    if (queueObj?.status === "duplicate") {
      if (queueObj.message_status === "failed") {
        return {
          success: false,
          error: "Esta mensagem falhou em uma tentativa anterior de envio.",
          code: "PREVIOUSLY_FAILED",
        };
      }
      const message = await getPersistedMessage(supabase, queueObj.message_id);
      return {
        success: true,
        messageId: queueObj.message_id,
        status: "duplicate",
        ...(message ? { message } : {}),
      };
    }

    if (queueObj?.status !== "queued" || !queueObj?.message_id) {
      return {
        success: false,
        error: "Retorno inesperado ao enfileirar mensagem",
        code: "QUEUE_UNEXPECTED_STATUS",
      };
    }

    const messageId = queueObj.message_id as string;
    const recipientTarget = queueObj.recipient_target as string;

    const admin = adminModule.createAdminSupabaseClient();

    // A instância vem do banco (a RPC de enfileirar já devolve a conexão ativa; nada vem do navegador);
    // EVOLUTION_INSTANCE_NAME é só reserva, para banco sem a migration. Sem conexão ativa, nada é enviado.
    const resolved = resolveSendInstance(queueObj);
    // Responder: liga a mensagem à citada e manda o `quoted` à Evolution (sem citação válida, o texto sai normal).
    const quoted = await attachReply(supabase, messageId, replyToMessageId, recipientTarget);
    const gatewayResult = resolved.ok
      ? await gatewayModule.sendEvolutionTextMessage(resolved.instance, recipientTarget, textContent, undefined, quoted)
      : { success: false as const, code: resolved.code, error: "Instância do WhatsApp indisponível" };

    // Só o aceite real do gateway conta como envio. O único contorno (dev/demo, nunca em
    // produção) vale para "WhatsApp não configurado"; falhas reais nunca viram "enviada".
    const outcome = classifyGatewayOutcome(gatewayResult);

    if (outcome.deliver) {
      const { error: reconcileError } = await admin.rpc(
        "reconcile_outgoing_text_message",
        {
          p_message_id: messageId,
          p_target_status: "sent",
          p_external_message_id: gatewayResult.success ? gatewayResult.externalMessageId : undefined,
        },
      );

      if (reconcileError) {
        console.error("Erro ao reconciliar status para sent:", reconcileError);
        // 23505: o eco da própria mensagem (webhook fromMe) chegou antes e já ocupa este identificador externo.
        // Sem tentar de novo a mensagem ficaria "na fila" para sempre; marca como enviada sem o identificador.
        if (reconcileError.code === "23505") {
          const { error: retryError } = await admin.rpc("reconcile_outgoing_text_message", {
            p_message_id: messageId,
            p_target_status: "sent",
            p_external_message_id: undefined,
          });
          if (retryError) console.error("Erro ao reconciliar status para sent (sem identificador externo):", retryError);
        }
      }

      // Sem revalidatePath: cada um deles faria o servidor renderizar de novo a rota inteira (lista incluída) dentro da
      // resposta do envio. A tela já atualiza sozinha (bolha provisória, mensagem gravada, Realtime); as demais
      // telas são dinâmicas e leem o banco quando abertas.
      const message = await getPersistedMessage(supabase, messageId);

      return {
        success: true,
        messageId,
        status: "sent",
        ...(message ? { message } : {}),
      };
    } else {
      // Só o código curto vai para o log (nunca texto da mensagem, número, corpo da Evolution ou segredo).
      console.error("Falha no envio pelo WhatsApp:", { code: outcome.code, gateway: gatewayResult.success ? null : gatewayResult.code ?? null, messageId });
      const { error: reconcileError } = await admin.rpc(
        "reconcile_outgoing_text_message",
        {
          p_message_id: messageId,
          p_target_status: "failed",
          p_external_message_id: undefined,
        },
      );

      if (reconcileError) {
        console.error("Erro ao reconciliar status para failed:", reconcileError);
      }

      return {
        success: false,
        error: outcome.error,
        code: outcome.code,
      };
    }
  } catch (error) {
    console.error("Erro não tratado na Server Action sendMessageAction:", error);
    return {
      success: false,
      error: "Erro interno no servidor ao processar envio",
      code: "INTERNAL_ERROR",
    };
  }
}

const MEDIA_RETRY_ERRORS: Record<mediaModule.MediaFailureCode, string> = {
  NOT_CONFIGURED: "O WhatsApp ainda não está conectado ao ImobFlux.",
  TIMEOUT: "Não foi possível falar com o WhatsApp agora. Tente novamente em instantes.",
  NETWORK_ERROR: "Não foi possível falar com o WhatsApp agora. Tente novamente em instantes.",
  HTTP_ERROR: "O WhatsApp não entregou o arquivo. Tente novamente em instantes.",
  INVALID_RESPONSE: "O WhatsApp devolveu o arquivo em formato inesperado.",
  TOO_LARGE: `O arquivo é maior que o limite de ${MAX_MEDIA_LABEL}. Abra no WhatsApp para vê-lo.`,
  STORAGE_ERROR: "Não foi possível guardar o arquivo agora. Tente novamente em instantes.",
  NOT_FOUND: "O WhatsApp não tem mais este arquivo. Abra a conversa no WhatsApp para vê-lo.",
};

/**
 * Server Action: tenta baixar de novo um anexo que ficou indisponível. O acesso ao anexo é
 * verificado pela RLS (mesma privacidade das mensagens) antes de qualquer chamada à Evolution.
 */
export async function retryAttachmentDownloadAction(
  attachmentId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!attachmentId || !UUID_REGEX.test(attachmentId)) {
    return { success: false, error: "Anexo inválido." };
  }

  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return { success: false, error: "Sessão expirada. Faça login novamente." };

    const { data: attachment } = await supabase
      .from("attachments")
      .select("id, status, created_at, size_bytes")
      .eq("id", attachmentId)
      .maybeSingle();
    if (!attachment) return { success: false, error: "Anexo não encontrado." };
    if (attachment.status === "available") return { success: true };
    if (attachment.status === "archived") return { success: false, error: "Este anexo foi arquivado." };
    if (isDownloadInProgress(attachment)) return { success: false, error: "O arquivo já está sendo carregado." };

    if (isMediaTooLarge(attachment.size_bytes)) return { success: false, error: MEDIA_RETRY_ERRORS.TOO_LARGE };

    const admin = adminModule.createAdminSupabaseClient();
    const source = await mediaModule.loadMediaSource(admin, attachmentId);
    if (!source) {
      return { success: false, error: "Não foi possível localizar este arquivo na conexão do WhatsApp." };
    }

    const result = await mediaModule.storeAttachmentMedia(admin, attachmentId, source, { timeoutMs: mediaModule.downloadTimeoutMs(attachment.size_bytes) });
    if (result.status === "available") return { success: true };
    return { success: false, error: MEDIA_RETRY_ERRORS[result.code] };
  } catch (error) {
    console.error("Erro em retryAttachmentDownloadAction:", error);
    return { success: false, error: "Não foi possível carregar o arquivo agora." };
  }
}

/**
 * Server Action: Cria uma oportunidade diretamente pelo painel de conversas e a vincula atomicamente.
 */
export async function createOpportunityFromConversationAction(input: {
  conversationId: string;
  contactId: string;
  stageId: string;
  title: string;
  description?: string;
  responsibleMemberId?: string;
}): Promise<{ success: true; opportunityId: string } | { success: false; error: string }> {
  const supabase = await serverModule.createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return { success: false, error: "Sessão não autenticada." };
  }

  const title = input.title?.trim();
  if (!title) {
    return { success: false, error: "Título da oportunidade é obrigatório." };
  }

  if (!input.conversationId || !UUID_REGEX.test(input.conversationId)) {
    return { success: false, error: "Conversa selecionada é inválida." };
  }

  if (!input.contactId || !UUID_REGEX.test(input.contactId)) {
    return { success: false, error: "Contato selecionado é inválido." };
  }

  if (!input.stageId || !UUID_REGEX.test(input.stageId)) {
    return { success: false, error: "Etapa selecionada é inválida." };
  }

  try {
    const { data: newId, error: createError } = await supabase.rpc(
      "create_opportunity",
      {
        p_contact_id: input.contactId,
        p_stage_id: input.stageId,
        p_title: title,
        p_description: input.description?.trim() || undefined,
        p_responsible_member_id: input.responsibleMemberId || undefined,
      },
    );

    if (createError || !newId) {
      console.error("Erro RPC create_opportunity em conversa:", createError);
      return { success: false, error: "Falha ao criar oportunidade." };
    }

    const opportunityId = newId as string;

    const { error: linkError } = await supabase.rpc("link_opportunity_conversation", {
      p_opportunity_id: opportunityId,
      p_conversation_id: input.conversationId,
    });

    if (linkError) {
      console.error("Erro RPC link_opportunity_conversation:", linkError);
    }

    revalidatePath(`/conversas/${input.conversationId}`);
    revalidatePath("/kanban");

    return { success: true, opportunityId };
  } catch (err) {
    console.error("Erro em createOpportunityFromConversationAction:", err);
    return { success: false, error: "Erro interno ao criar oportunidade a partir da conversa." };
  }
}

/**
 * Server Action: Marca conversa como não lida/lida.
 */
export async function markConversationUnreadAction(
  conversationId: string,
  unread: boolean = true,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await supabase.rpc("mark_conversation_unread", {
      p_conversation_id: conversationId,
      p_unread: unread,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/conversas/${conversationId}`);
    revalidatePath("/conversas");
    return { success: true };
  } catch (err) {
    console.error("Erro em markConversationUnreadAction:", err);
    return { success: false, error: "Falha ao atualizar estado de leitura." };
  }
}

/** Auto-read ao abrir: executado pelo cliente e sem invalidar a rota em renderizaÃ§Ã£o. */
export async function markConversationReadOnOpenAction(
  conversationId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await supabase.rpc("mark_conversation_unread", {
      p_conversation_id: conversationId,
      p_unread: false,
    });

    return error
      ? { success: false, error: error.message }
      : { success: true };
  } catch (err) {
    console.error("Erro em markConversationReadOnOpenAction:", err);
    return { success: false, error: "Falha ao atualizar estado de leitura." };
  }
}

/**
 * Server Action: Salva uma nota interna associada à conversa.
 */
export async function saveInternalNoteAction(
  conversationId: string,
  content: string,
  opportunityId?: string | null,
): Promise<{
  success: boolean;
  noteId?: string;
  note?: ConversationContextData["notes"][number];
  error?: string;
}> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data, error } = await supabase.rpc("save_internal_note", {
      p_conversation_id: conversationId,
      p_content: content,
      p_opportunity_id: opportunityId ?? undefined,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/conversas/${conversationId}`);
    const result = data as {
      note_id?: string;
      note?: ConversationContextData["notes"][number];
    } | null;
    return {
      success: true,
      noteId: result?.note_id,
      note: result?.note,
    };
  } catch (err) {
    console.error("Erro em saveInternalNoteAction:", err);
    return { success: false, error: "Falha ao salvar nota interna." };
  }
}

export async function updateConversationContactNameAction(
  conversationId: string,
  displayName: string,
): Promise<{
  success: boolean;
  displayName?: string;
  registrationStatus?: string;
  error?: string;
}> {
  const normalizedName = displayName.trim();
  if (!UUID_REGEX.test(conversationId) || normalizedName.length < 2 || normalizedName.length > 120) {
    return { success: false, error: "Informe um nome entre 2 e 120 caracteres." };
  }

  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data, error } = await supabase.rpc("update_conversation_contact_name", {
      p_conversation_id: conversationId,
      p_display_name: normalizedName,
    });
    if (error) return { success: false, error: "Não foi possível atualizar o nome deste contato." };

    const result = data as {
      display_name?: string;
      registration_status?: string;
    } | null;
    revalidatePath(`/conversas/${conversationId}`);
    revalidatePath("/conversas");
    revalidatePath("/contatos");
    return {
      success: true,
      displayName: result?.display_name ?? normalizedName,
      registrationStatus: result?.registration_status,
    };
  } catch (error) {
    console.error("Erro em updateConversationContactNameAction:", error);
    return { success: false, error: "Falha ao atualizar o nome do contato." };
  }
}

/**
 * Server Action: Cria ou atualiza uma tarefa (Próxima Ação ou Follow-up).
 */
export async function upsertWorkTaskAction(input: {
  conversationId?: string;
  contactId?: string;
  opportunityId?: string;
  taskType: "task" | "follow_up";
  title: string;
  dueAt?: string;
  taskId?: string;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("upsert_work_task", {
      p_task_type: input.taskType,
      p_title: input.title,
      p_due_at: input.dueAt ? new Date(input.dueAt).toISOString() : null,
      p_contact_id: input.contactId ?? null,
      p_opportunity_id: input.opportunityId ?? null,
      p_conversation_id: input.conversationId ?? null,
      p_task_id: input.taskId ?? null,
    });

    if (error) {
      // Ex.: task_not_pending (tarefa já concluída/cancelada não é editável): mensagem clara, sem código técnico.
      return { success: false, error: taskErrorMessage(error.message) };
    }

    if (input.conversationId) {
      revalidatePath(`/conversas/${input.conversationId}`);
    }
    revalidatePath("/hoje");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { success: true, taskId: (data as any)?.task_id };
  } catch (err) {
    console.error("Erro em upsertWorkTaskAction:", err);
    return { success: false, error: "Falha ao salvar tarefa." };
  }
}

/**
 * Server Action: Conclui uma tarefa.
 */
export async function completeWorkTaskAction(
  taskId: string,
  conversationId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await supabase.rpc("complete_work_task", {
      p_task_id: taskId,
    });

    if (error) {
      // Concluir de novo uma tarefa já concluída é sucesso (idempotente no banco); sobra o caso de tarefa cancelada.
      return { success: false, error: taskErrorMessage(error.message) };
    }

    if (conversationId) {
      revalidatePath(`/conversas/${conversationId}`);
    }
    revalidatePath("/hoje");
    return { success: true };
  } catch (err) {
    console.error("Erro em completeWorkTaskAction:", err);
    return { success: false, error: "Falha ao concluir tarefa." };
  }
}

/**
 * Server Action: Atualiza qualificações do contato e da oportunidade a partir do painel lateral.
 */
export async function updateQualificationAction(input: {
  contactId: string;
  opportunityId?: string;
  conversationId?: string;
  operationType?: string;
  propertyTypePreference?: string;
  cityRegionPreference?: string;
  maxPriceBudget?: number;
  availableDownPayment?: number;
  timeframeIntent?: string;
  familyIncome?: number;
  financialAnalysisStatus?: string;
  approvedCreditAmount?: number;
  docsStatus?: string;
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await supabase.rpc("update_contact_opportunity_qualification", {
      p_contact_id: input.contactId,
      p_opportunity_id: input.opportunityId || undefined,
      p_operation_type: input.operationType || undefined,
      p_property_type_preference: input.propertyTypePreference || undefined,
      p_city_region_preference: input.cityRegionPreference || undefined,
      p_max_price_budget: input.maxPriceBudget ?? undefined,
      p_available_down_payment: input.availableDownPayment ?? undefined,
      p_timeframe_intent: input.timeframeIntent || undefined,
      p_family_income: input.familyIncome ?? undefined,
      p_financial_analysis_status: input.financialAnalysisStatus || undefined,
      p_approved_credit_amount: input.approvedCreditAmount ?? undefined,
      p_docs_status: input.docsStatus || undefined,
      p_notes: input.notes || undefined,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (input.conversationId) {
      revalidatePath(`/conversas/${input.conversationId}`);
    }
    revalidatePath("/kanban");
    return { success: true };
  } catch (err) {
    console.error("Erro em updateQualificationAction:", err);
    return { success: false, error: "Falha ao atualizar dados de qualificação." };
  }
}

// ─── Atribuição de conversa (fluxos 18 e 19) ───────────────────────────────────────────────────

export type AssignmentActionResult = { success: true; status: string } | { success: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function runAssignmentRpc(
  conversationId: string,
  ids: string[],
  call: (supabase: Awaited<ReturnType<typeof serverModule.createServerSupabaseClient>>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<AssignmentActionResult> {
  if (![conversationId, ...ids].every((id) => typeof id === "string" && UUID_PATTERN.test(id))) {
    return { success: false, error: "Dados inválidos." };
  }
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data, error } = await call(supabase);
    if (error) return { success: false, error: assignmentErrorMessage(error.message) };
    revalidatePath("/conversas");
    revalidatePath(`/conversas/${conversationId}`);
    return { success: true, status: (data as { status?: string } | null)?.status ?? "success" };
  } catch (error) {
    console.error("Erro ao alterar responsável da conversa:", error);
    return { success: false, error: assignmentErrorMessage(null) };
  }
}

export async function assignConversationAction(conversationId: string, memberId: string): Promise<AssignmentActionResult> {
  return runAssignmentRpc(conversationId, [memberId], (supabase) =>
    supabase.rpc("assign_conversation", { p_conversation_id: conversationId, p_member_id: memberId }));
}

export async function unassignConversationAction(conversationId: string, memberId: string): Promise<AssignmentActionResult> {
  return runAssignmentRpc(conversationId, [memberId], (supabase) =>
    supabase.rpc("unassign_conversation", { p_conversation_id: conversationId, p_member_id: memberId }));
}

export async function reassignConversationAction(
  conversationId: string,
  fromMemberId: string,
  toMemberId: string,
): Promise<AssignmentActionResult> {
  return runAssignmentRpc(conversationId, [fromMemberId, toMemberId], (supabase) =>
    supabase.rpc("reassign_conversation", {
      p_conversation_id: conversationId,
      p_from_member_id: fromMemberId,
      p_to_member_id: toMemberId,
    }));
}


export type SlaModeResult =
  | { success: true; sla_mode: "active" | "paused" | "disabled"; sla_paused_at: string | null; sla_applies: boolean }
  | { success: false; error: string };

const SLA_MODE_ERRORS: Record<string, string> = {
  sla_not_authorized: "Você não tem acesso a esta conversa.",
  sla_not_applicable: "Grupos e a conversa com você mesmo nunca têm prazo.",
  conversation_not_available: "Esta conversa não está mais disponível.",
  sla_mode_invalid: "Opção de prazo inválida.",
};

/**
 * Server Action: pausa (até o cliente falar de novo), desativa (permanente) ou reativa o prazo de UMA conversa.
 * Quem tem acesso à conversa pode; o banco audita e decide se há prazo (uma regra só para todas as telas).
 */
export async function setConversationSlaModeAction(
  conversationId: string,
  mode: "active" | "paused" | "disabled",
): Promise<SlaModeResult> {
  if (!UUID_REGEX.test(conversationId) || !["active", "paused", "disabled"].includes(mode)) {
    return { success: false, error: SLA_MODE_ERRORS.sla_mode_invalid };
  }
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data, error } = await supabase.rpc("set_conversation_sla_mode", { p_conversation_id: conversationId, p_mode: mode });
    if (error) {
      const known = Object.keys(SLA_MODE_ERRORS).find((code) => error.message?.includes(code));
      return { success: false, error: known ? SLA_MODE_ERRORS[known] : "Não foi possível alterar o prazo desta conversa." };
    }
    const result = data as { sla_mode: "active" | "paused" | "disabled"; sla_paused_at: string | null; sla_applies?: boolean };
    return {
      success: true,
      sla_mode: result.sla_mode,
      sla_paused_at: result.sla_paused_at ?? null,
      sla_applies: result.sla_applies ?? result.sla_mode === "active",
    };
  } catch (error) {
    console.error("Erro em setConversationSlaModeAction:", (error as { code?: string } | null)?.code ?? "desconhecido");
    return { success: false, error: "Falha ao alterar o prazo desta conversa." };
  }
}
