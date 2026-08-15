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
  last_msg_author_name?: string | null;
  participant_name: string | null;
  participant_phone?: string | null;
  contact_id?: string | null;
  is_unread?: boolean;
  archived_at?: string | null;
  avatar_url?: string | null;
  /** Cursores do próximo lote — retornados pela RPC */
  next_cursor_ts: string | null;
  next_cursor_id: string | null;
};

export type ConversationInboxView = "all" | "unread" | "groups" | "archived";
export type ConversationInboxCounts = {
  all: number;
  unread: number;
  groups: number;
  archived: number;
  archived_unread: number;
};
export type ConversationInboxPage = {
  items: ConversationListItem[];
  counts: ConversationInboxCounts;
};

/** Parâmetros aceitos pela função de listagem. */
export type GetConversationsListParams = {
  search?: string;
  cursor?: ConversationsCursor;
  limit?: number;
  view?: ConversationInboxView;
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
  internal_author_name?: string | null;
  sender_display_name?: string | null;
};

/** Cursor para paginação de mensagens. */
export type MessagesCursor = {
  occurred_at: string;
  id: string;
};

export type ConversationMessagesPage = {
  messages: ConversationMessage[];
  hasMore: boolean;
};

export type NewConversationCandidate = {
  contactId: string | null;
  conversationId: string | null;
  displayName: string;
  phone: string | null;
};

export type LinkedOpportunityInfo = {
  opportunity_id: string;
  title: string;
  current_stage_id: string;
  contact_id: string;
  status: string;
};

export type ConversationContextData = {
  contact: {
    id: string;
    display_name: string;
    classification: string;
    operational_status: string;
    registration_status?: string | null;
    notes: string | null;
    created_at: string;
    phone: string | null;
  } | null;
  active_opportunity: {
    opportunity_id: string;
    title: string;
    description: string | null;
    current_stage_id: string;
    stage_name: string;
    status: string;
    responsible_member_id: string | null;
    responsible_name: string | null;
    operation_type: string | null;
    property_type_preference: string | null;
    city_region_preference: string | null;
    max_price_budget: number | string | null;
    available_down_payment: number | null;
    timeframe_intent: string | null;
    preferences_notes: string | null;
    rework_reason: string | null;
  } | null;
  all_opportunities: Array<{
    opportunity_id: string;
    title: string;
    current_stage_id: string;
    stage_name: string;
    status: string;
  }>;
  financial_info: {
    family_income: number | null;
    financial_analysis_status: string | null;
    approved_credit_amount: number | null;
    financial_notes: string | null;
    docs_status: string | null;
  } | null;
  tasks: Array<{
    id: string;
    task_type: "task" | "follow_up";
    title: string;
    description: string | null;
    status: "pending" | "completed" | "cancelled";
    due_at: string;
    created_at: string;
  }>;
  notes: Array<{
    id: string;
    content: string;
    created_at: string;
    author_name: string;
  }>;
  timeline: Array<{
    event_type: "stage_change" | "internal_note" | "task";
    occurred_at: string;
    title: string;
    description: string;
    actor: string;
  }>;
  caller_role: "owner" | "attendant";
};

export type ConversationPipelineStage = {
  id: string;
  name: string;
};

// ─── Funções de leitura (consumidas exclusivamente por Server Components) ─────

/**
 * Carrega a lista autorizada de conversas pelo read model único da inbox.
 */
export async function getConversationsList(
  params: GetConversationsListParams = {},
): Promise<ConversationListItem[]> {
  return (await getConversationsInbox(params)).items;
}

export async function getConversationsInbox(
  params: GetConversationsListParams = {},
): Promise<ConversationInboxPage> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("get_conversations_inbox", {
    p_view: params.view ?? "all",
    p_search: params.search ?? undefined,
    p_cursor_ts: params.cursor?.ts ?? undefined,
    p_cursor_id: params.cursor?.id ?? undefined,
    p_limit: params.limit ?? 20,
  });

  if (error) {
    throw new Error("Não foi possível carregar a lista de conversas.");
  }

  const result = data as unknown as ConversationInboxPage | null;
  const items = result?.items ?? [];
  const last = items.at(-1);

  return {
    items: items.map((item) => ({
      ...item,
      next_cursor_ts: last?.last_activity_at ?? null,
      next_cursor_id: last?.conversation_id ?? null,
    })),
    counts: result?.counts ?? {
      all: 0,
      unread: 0,
      groups: 0,
      archived: 0,
      archived_unread: 0,
    },
  };
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
    .select("id, conversation_type, visibility, operational_status, started_at, archived_at")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv) return null;

  return {
    conversation_id: conv.id,
    conversation_type: conv.conversation_type,
    visibility: conv.visibility,
    operational_status: conv.operational_status,
    started_at: conv.started_at,
    archived_at: conv.archived_at,
    last_activity_at: conv.started_at,
    last_msg_text: null,
    last_msg_direction: null,
    last_msg_occurred_at: null,
    last_msg_author_name: null,
    participant_name: null,
    participant_phone: null,
    contact_id: null,
    is_unread: false,
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
 * Busca contexto completo para o painel lateral do cliente.
 */
export async function getConversationContext(
  conversationId: string,
): Promise<ConversationContextData | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_conversation_context", {
    p_conversation_id: conversationId,
  });

  if (error || !data) return null;
  return data as ConversationContextData;
}

/**
 * Reconstrói o contexto de cada oportunidade ativa sem misturar dados entre
 * operações do mesmo contato. A RPC continua sendo a fonte da identificação
 * do contato e do papel do usuário; os dados operacionais são filtrados pelo
 * opportunity_id selecionado.
 */
export async function getConversationOpportunityContexts(
  baseContext: ConversationContextData | null,
  conversationId: string,
): Promise<ConversationContextData[]> {
  if (!baseContext) return [];

  const activeOpportunities = baseContext.all_opportunities.filter((opportunity) =>
    ["active", "open"].includes(opportunity.status),
  );

  if (activeOpportunities.length === 0) return [];

  const supabase = await createServerSupabaseClient();

  const contexts = await Promise.all(
    activeOpportunities.map(async (summary): Promise<ConversationContextData | null> => {
      const { data: opportunity, error: opportunityError } = await supabase
        .from("opportunities")
        .select(
          "id, contact_id, title, description, current_stage_id, status, responsible_member_id, operation_type, property_type_preference, city_region_preference, value_range_preference, down_payment_available, timeframe_intent, property_summary, preferences_notes, rework_reason, family_income, financial_analysis_status, approved_amount, financial_notes, documentation_status",
        )
        .eq("id", summary.opportunity_id)
        .eq("contact_id", baseContext.contact?.id ?? "")
        .is("archived_at", null)
        .maybeSingle();

      if (opportunityError || !opportunity) return null;

      const [{ data: tasks }, notesResult, { data: history }] = await Promise.all([
        supabase
          .from("work_tasks")
          .select("id, task_type, title, description, status, due_at, created_at, created_by_member_id")
          .eq("opportunity_id", opportunity.id)
          .is("archived_at", null)
          .order("due_at", { ascending: true }),
        supabase.rpc("get_visible_internal_notes", {
          p_conversation_id: conversationId,
          p_opportunity_id: opportunity.id,
        }),
        supabase
          .from("pipeline_history")
          .select("new_stage_id, previous_stage_id, reason, changed_at, changed_by_member_id")
          .eq("opportunity_id", opportunity.id)
          .order("changed_at", { ascending: false })
          .limit(30),
      ]);
      if (notesResult.error) {
        console.error("Erro ao carregar notas autoritativas da oportunidade:", notesResult.error);
      }
      const notes = notesResult.data;

      const stageIds = [
        opportunity.current_stage_id,
        ...(history ?? []).flatMap((item) =>
          [item.previous_stage_id, item.new_stage_id].filter((id): id is string => Boolean(id)),
        ),
      ];
      const memberIds = [
        opportunity.responsible_member_id,
        ...(tasks ?? []).map((task) => task.created_by_member_id),
        ...(history ?? []).map((item) => item.changed_by_member_id),
      ].filter((id): id is string => Boolean(id));

      const [{ data: stageRows }, { data: memberRows }] = await Promise.all([
        supabase.from("pipeline_stages").select("id, name").in("id", [...new Set(stageIds)]),
        memberIds.length > 0
          ? supabase
              .from("workspace_members")
              .select("id, user_id")
              .in("id", [...new Set(memberIds)])
          : Promise.resolve({ data: [] }),
      ]);

      const userIds = (memberRows ?? [])
        .map((member) => member.user_id)
        .filter((id): id is string => Boolean(id));
      const { data: userRows } = userIds.length > 0
        ? await supabase.from("app_users").select("id, display_name").in("id", userIds)
        : { data: [] };

      const stageNames = new Map((stageRows ?? []).map((stage) => [stage.id, stage.name]));
      const userNames = new Map((userRows ?? []).map((user) => [user.id, user.display_name]));
      const memberNames = new Map(
        (memberRows ?? []).map((member) => [
          member.id,
          member.user_id ? userNames.get(member.user_id) ?? "Usuário" : "Usuário",
        ]),
      );

      const mappedTasks: ConversationContextData["tasks"] = (tasks ?? []).map((task) => ({
        id: task.id,
        task_type: task.task_type as "task" | "follow_up",
        title: task.title,
        description: task.description,
        status: task.status as "pending" | "completed" | "cancelled",
        due_at: task.due_at,
        created_at: task.created_at,
      }));
      const mappedNotes: ConversationContextData["notes"] = (notes ?? []).map((note) => ({
        id: note.id,
        content: note.content,
        created_at: note.created_at,
        author_name: note.author_name,
      }));
      const timeline: ConversationContextData["timeline"] = [
        ...(history ?? []).map((item) => ({
          event_type: "stage_change" as const,
          occurred_at: item.changed_at,
          title: "Etapa alterada",
          description: `${item.previous_stage_id ? stageNames.get(item.previous_stage_id) ?? "Etapa anterior" : "Início"} → ${stageNames.get(item.new_stage_id) ?? "Nova etapa"}${item.reason ? ` — ${item.reason}` : ""}`,
          actor: memberNames.get(item.changed_by_member_id) ?? "Usuário",
        })),
        ...mappedNotes.map((note) => ({
          event_type: "internal_note" as const,
          occurred_at: note.created_at,
          title: "Nota interna",
          description: note.content,
          actor: note.author_name,
        })),
        ...mappedTasks.map((task) => ({
          event_type: "task" as const,
          occurred_at: task.created_at,
          title: task.task_type === "follow_up" ? "Follow-up" : "Próxima ação",
          description: task.title,
          actor: "",
        })),
      ]
        .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
        .slice(0, 30);

      return {
        ...baseContext,
        active_opportunity: {
          opportunity_id: opportunity.id,
          title: opportunity.title,
          description: opportunity.description,
          current_stage_id: opportunity.current_stage_id,
          stage_name: stageNames.get(opportunity.current_stage_id) ?? summary.stage_name,
          status: opportunity.status,
          responsible_member_id: opportunity.responsible_member_id,
          responsible_name: opportunity.responsible_member_id
            ? memberNames.get(opportunity.responsible_member_id) ?? null
            : null,
          operation_type: opportunity.operation_type,
          property_type_preference: opportunity.property_type_preference,
          city_region_preference: opportunity.city_region_preference,
          max_price_budget: opportunity.value_range_preference,
          available_down_payment: opportunity.down_payment_available,
          timeframe_intent: opportunity.timeframe_intent,
          preferences_notes: opportunity.property_summary ?? opportunity.preferences_notes,
          rework_reason: opportunity.rework_reason,
        },
        financial_info: baseContext.caller_role === "owner"
          ? {
              family_income: opportunity.family_income,
              financial_analysis_status: opportunity.financial_analysis_status,
              approved_credit_amount: opportunity.approved_amount,
              financial_notes: opportunity.financial_notes,
              docs_status: opportunity.documentation_status,
            }
          : null,
        tasks: mappedTasks,
        notes: mappedNotes,
        timeline,
      };
    }),
  );

  return contexts.filter((context): context is ConversationContextData => context !== null);
}

export async function getVisibleInternalNotes(
  conversationId: string,
  opportunityId?: string | null,
): Promise<ConversationContextData["notes"]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_visible_internal_notes", {
    p_conversation_id: conversationId,
    p_opportunity_id: opportunityId ?? undefined,
  });
  if (error) {
    console.error("Erro ao carregar notas internas autoritativas:", error);
    return [];
  }
  return (data ?? []).map((note) => ({
    id: note.id,
    content: note.content,
    created_at: note.created_at,
    author_name: note.author_name,
  }));
}

export async function getConversationPipelineStages(
  conversationId: string,
): Promise<ConversationPipelineStage[]> {
  const supabase = await createServerSupabaseClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("workspace_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conversation) return [];

  const { data } = await supabase
    .from("pipeline_stages")
    .select("id, name")
    .eq("workspace_id", conversation.workspace_id)
    .eq("is_active", true)
    .order("position", { ascending: true });

  return data ?? [];
}

/**
 * Carrega as mensagens de uma conversa específica com o nome do autor interno.
 */
export async function getConversationMessages(
  conversationId: string,
  cursor?: MessagesCursor,
): Promise<ConversationMessagesPage> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_conversation_messages", {
    p_conversation_id: conversationId,
    p_cursor_occurred_at: cursor?.occurred_at,
    p_cursor_id: cursor?.id,
    p_limit: 50,
  });

  if (error) {
    console.error("Erro ao carregar histórico de mensagens:", error);
    throw new Error("Não foi possível carregar o histórico de mensagens.");
  }

  const page = data as unknown as {
    messages?: ConversationMessage[];
    has_more?: boolean;
  } | null;

  return {
    messages: page?.messages ?? [],
    hasMore: page?.has_more ?? false,
  };
}
