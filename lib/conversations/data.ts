import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

// ─── Tipos internos ───────────────────────────────────────────────────────────

/** Cursor estável para paginação da lista de conversas. */
export type ConversationsCursor = {
  ts: string; // ISO-8601 (last_activity_at do último item)
  id: string; // UUID (conversation_id do último item)
};

/** Um item da listagem de conversas retornado pela RPC. */
export type ConversationListItem = {
  conversation_id: string;
  conversation_type: string; // 'individual' | 'group'
  visibility: string; // 'commercial' | 'owner_only'
  operational_status: string;
  started_at: string;
  last_activity_at: string;
  last_msg_text: string | null;
  last_msg_direction: string | null; // 'incoming' | 'outgoing'
  last_msg_occurred_at: string | null;
  participant_name: string | null;
  /** Cursores do próximo lote — retornados pela RPC */
  next_cursor_ts: string | null;
  next_cursor_id: string | null;
};

/** Parâmetros aceitos pela função de listagem. */
export type GetConversationsListParams = {
  search?: string;
  cursor?: ConversationsCursor;
  limit?: number;
};

/** Uma mensagem individual para exibição no painel de histórico. */
export type ConversationMessage = {
  id: string;
  direction: string; // 'incoming' | 'outgoing'
  origin: string; // 'crm' | 'whatsapp'
  status: string;
  text_content: string | null;
  occurred_at: string;
  has_attachments: boolean;
};

/** Cursor para paginação de mensagens. */
export type MessagesCursor = {
  occurred_at: string;
  id: string;
};

export type LinkedOpportunityInfo = {
  opportunity_id: string;
  title: string;
  current_stage_id: string;
  contact_id: string;
  status: string;
};

// ─── Funções de leitura (consumidas exclusivamente por Server Components) ─────

/**
 * Carrega a lista de conversas via RPC `get_conversations_list`.
 */
export async function getConversationsList(
  params: GetConversationsListParams = {},
): Promise<ConversationListItem[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("get_conversations_list", {
    p_search: params.search ?? undefined,
    p_cursor_ts: params.cursor?.ts ?? undefined,
    p_cursor_id: params.cursor?.id ?? undefined,
    p_limit: params.limit ?? 20,
  });

  if (error) {
    throw new Error("Não foi possível carregar a lista de conversas.");
  }

  return (data as ConversationListItem[]) ?? [];
}

/**
 * Carrega os dados de uma conversa específica pelo ID.
 */
export async function getConversationById(
  conversationId: string,
): Promise<ConversationListItem | null> {
  const list = await getConversationsList({ limit: 100 });
  const found = list.find((c) => c.conversation_id === conversationId);
  if (found) return found;

  const supabase = await createServerSupabaseClient();
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, conversation_type, visibility, operational_status, started_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv) return null;

  return {
    conversation_id: conv.id,
    conversation_type: conv.conversation_type,
    visibility: conv.visibility,
    operational_status: conv.operational_status,
    started_at: conv.started_at,
    last_activity_at: conv.started_at,
    last_msg_text: null,
    last_msg_direction: null,
    last_msg_occurred_at: null,
    participant_name: null,
    next_cursor_ts: null,
    next_cursor_id: null,
  };
}

/**
 * Busca oportunidade vinculada à conversa via RPC `get_opportunity_for_conversation`.
 */
export async function getOpportunityForConversation(
  conversationId: string,
): Promise<LinkedOpportunityInfo | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_opportunity_for_conversation", {
    p_conversation_id: conversationId,
  });

  if (error || !data) return null;
  return data as LinkedOpportunityInfo;
}

/**
 * Carrega as mensagens de uma conversa específica.
 */
export async function getConversationMessages(
  conversationId: string,
  cursor?: MessagesCursor,
): Promise<ConversationMessage[]> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("messages")
    .select("id, direction, origin, status, text_content, occurred_at")
    .eq("conversation_id", conversationId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);

  if (cursor) {
    query = query.or(
      `occurred_at.lt.${cursor.occurred_at},and(occurred_at.eq.${cursor.occurred_at},id.lt.${cursor.id})`,
    );
  }

  const { data: messages, error: msgError } = await query;

  if (msgError) {
    throw new Error("Não foi possível carregar o histórico de mensagens.");
  }

  if (!messages || messages.length === 0) {
    return [];
  }

  const messageIds = messages.map((m) => m.id);

  const { data: attachments } = await supabase
    .from("attachments")
    .select("message_id")
    .in("message_id", messageIds);

  const messageIdsWithAttachments = new Set(
    (attachments ?? []).map((a) => a.message_id),
  );

  const sorted = [...messages].reverse();

  return sorted.map((m) => ({
    id: m.id,
    direction: m.direction,
    origin: m.origin,
    status: m.status,
    text_content: m.text_content,
    occurred_at: m.occurred_at,
    has_attachments: messageIdsWithAttachments.has(m.id),
  }));
}
