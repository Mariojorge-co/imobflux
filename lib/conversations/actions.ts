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
    .select("id, direction, origin, status, text_content, occurred_at, internal_author_member_id")
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
      revalidatePath(`/conversas/${conversationId}`);
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

    const gatewayResult = await gatewayModule.sendEvolutionTextMessage(
      undefined,
      recipientTarget,
      textContent,
    );

    const admin = adminModule.createAdminSupabaseClient();

    // Se o envio externo foi bem sucedido OU se estamos no Demo Mode / ambiente local sem gateway configurado
    const isDemoOrLocalMode =
      process.env.NEXT_PUBLIC_DEMO_MODE === "true" ||
      process.env.NODE_ENV === "development" ||
      (!gatewayResult.success &&
        (gatewayResult.code === "GATEWAY_NOT_CONFIGURED" ||
          gatewayResult.code === "MISSING_EVOLUTION_API_KEY"));

    if (gatewayResult.success || isDemoOrLocalMode) {
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
      }

      revalidatePath(`/conversas/${conversationId}`);
      revalidatePath("/conversas");
      revalidatePath("/prioridades");

      const message = await getPersistedMessage(supabase, messageId);

      return {
        success: true,
        messageId,
        status: "sent",
        ...(message ? { message } : {}),
      };
    } else {
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

      revalidatePath(`/conversas/${conversationId}`);
      return {
        success: false,
        error: "Falha ao enviar mensagem via WhatsApp",
        code: "GATEWAY_ERROR",
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
      return { success: false, error: error.message };
    }

    if (input.conversationId) {
      revalidatePath(`/conversas/${input.conversationId}`);
    }
    revalidatePath("/prioridades");
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
      return { success: false, error: error.message };
    }

    if (conversationId) {
      revalidatePath(`/conversas/${conversationId}`);
    }
    revalidatePath("/prioridades");
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
