"use server";

import { revalidatePath } from "next/cache";
import {
  getConversationsList,
  getConversationMessages,
} from "@/lib/conversations/data";
import type {
  ConversationListItem,
  ConversationMessage,
  ConversationsCursor,
  MessagesCursor,
} from "@/lib/conversations/data";
import * as serverModule from "@/lib/supabase/server";
import * as adminModule from "@/lib/supabase/admin";
import * as gatewayModule from "@/lib/supabase/gateway";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_TEXT_LENGTH = 4096;

export type SendMessageResult =
  | { success: true; messageId: string; status: "sent" | "queued" | "duplicate" }
  | { success: false; error: string; code?: string };

/**
 * Server Action: pesquisa ou carrega mais conversas.
 */
export async function searchConversationsAction(
  search: string,
  cursor: ConversationsCursor | undefined,
): Promise<ConversationListItem[]> {
  return getConversationsList({ search: search || undefined, cursor });
}

/**
 * Server Action: carrega mensagens anteriores de uma conversa.
 */
export async function loadMoreMessagesAction(
  conversationId: string,
  cursor: MessagesCursor,
): Promise<ConversationMessage[]> {
  return getConversationMessages(conversationId, cursor);
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
      return {
        success: true,
        messageId: queueObj.message_id,
        status: "duplicate",
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

    if (gatewayResult.success) {
      const { error: reconcileError } = await admin.rpc(
        "reconcile_outgoing_text_message",
        {
          p_message_id: messageId,
          p_target_status: "sent",
          p_external_message_id: gatewayResult.externalMessageId || undefined,
        },
      );

      if (reconcileError) {
        console.error("Erro ao reconciliar status para sent:", reconcileError);
      }

      revalidatePath(`/conversas/${conversationId}`);
      return {
        success: true,
        messageId,
        status: "sent",
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
