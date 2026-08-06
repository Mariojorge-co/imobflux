"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  ArchiveOpportunityResult,
  CreateOpportunityInput,
  CreateOpportunityResult,
  KanbanCard,
  MoveOpportunityResult,
  OpenOrCreateConversationResult,
  UpdateOpportunityInput,
  UpdateOpportunityResult,
} from "@/types/kanban";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Server Action: Movimenta uma oportunidade para uma nova etapa do Kanban.
 */
export async function moveOpportunityAction(
  opportunityId: string,
  expectedCurrentStageId: string,
  newStageId: string,
  reason?: string,
): Promise<MoveOpportunityResult> {
  const supabase = await createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "Sessão não autenticada.",
    };
  }

  if (
    !opportunityId ||
    !UUID_REGEX.test(opportunityId) ||
    !expectedCurrentStageId ||
    !UUID_REGEX.test(expectedCurrentStageId) ||
    !newStageId ||
    !UUID_REGEX.test(newStageId)
  ) {
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: "Identificadores inválidos fornecidos.",
    };
  }

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "move_opportunity_stage",
      {
        p_opportunity_id: opportunityId,
        p_expected_current_stage_id: expectedCurrentStageId,
        p_new_stage_id: newStageId,
        p_reason: reason || undefined,
      },
    );

    if (rpcError) {
      console.error("Erro RPC move_opportunity_stage:", rpcError);
      return {
        success: false,
        code: "INTERNAL_ERROR",
        error: "Falha ao movimentar a oportunidade no banco de dados.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resultObj = rpcData as any;

    if (resultObj?.status === "conflict") {
      return {
        success: false,
        code: "CONFLICT",
        error: resultObj.message || "A oportunidade foi alterada por outra operação.",
      };
    }

    revalidatePath("/kanban");

    return {
      success: true,
      status: resultObj?.status === "no_change" ? "no_change" : "success",
      opportunityId,
    };
  } catch (err) {
    console.error("Erro inesperado em moveOpportunityAction:", err);
    return {
      success: false,
      code: "INTERNAL_ERROR",
      error: "Erro interno ao processar a movimentação.",
    };
  }
}

/**
 * Server Action: Cria uma nova oportunidade associada a um contato e etapa.
 */
export async function createOpportunityAction(
  input: CreateOpportunityInput,
): Promise<CreateOpportunityResult> {
  const supabase = await createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return {
      success: false,
      error: "Sessão não autenticada.",
    };
  }

  const title = input.title?.trim();
  if (!title) {
    return {
      success: false,
      error: "O título da oportunidade é obrigatório.",
    };
  }

  if (!input.contactId || !UUID_REGEX.test(input.contactId)) {
    return {
      success: false,
      error: "Contato selecionado é inválido.",
    };
  }

  if (!input.stageId || !UUID_REGEX.test(input.stageId)) {
    return {
      success: false,
      error: "Etapa selecionada é inválida.",
    };
  }

  if (
    input.responsibleMemberId &&
    !UUID_REGEX.test(input.responsibleMemberId)
  ) {
    return {
      success: false,
      error: "Responsável selecionado é inválido.",
    };
  }

  try {
    const { data: newId, error: rpcError } = await supabase.rpc(
      "create_opportunity",
      {
        p_contact_id: input.contactId,
        p_stage_id: input.stageId,
        p_title: title,
        p_description: input.description?.trim() || undefined,
        p_responsible_member_id: input.responsibleMemberId || undefined,
      },
    );

    if (rpcError || !newId) {
      console.error("Erro RPC create_opportunity:", rpcError);
      return {
        success: false,
        error: "Falha ao criar oportunidade no banco de dados.",
      };
    }

    let opportunityCard: KanbanCard | undefined;

    if (typeof supabase.from === "function") {
      try {
        const { data: createdOpp } = await supabase
          .from("opportunities")
          .select(`
            id,
            title,
            description,
            created_at,
            updated_at,
            contact_id,
            responsible_member_id,
            contacts (
              display_name,
              classification
            ),
            workspace_members (
              app_users (
                display_name
              )
            )
          `)
          .eq("id", newId as string)
          .maybeSingle();

        if (createdOpp) {
          const contactObj = Array.isArray(createdOpp.contacts)
            ? createdOpp.contacts[0]
            : createdOpp.contacts;
          const memberObj = Array.isArray(createdOpp.workspace_members)
            ? createdOpp.workspace_members[0]
            : createdOpp.workspace_members;
          const userObj = Array.isArray(memberObj?.app_users)
            ? memberObj?.app_users[0]
            : memberObj?.app_users;

          opportunityCard = {
            id: createdOpp.id,
            title: createdOpp.title,
            description: createdOpp.description,
            created_at: createdOpp.created_at,
            updated_at: createdOpp.updated_at,
            contact_id: createdOpp.contact_id,
            contact_name: contactObj?.display_name || "",
            contact_classification: contactObj?.classification || "person",
            responsible_member_id: createdOpp.responsible_member_id,
            responsible_name: userObj?.display_name || null,
            has_linked_conversation: false,
            linked_conversation_id: null,
          };
        }
      } catch (e) {
        console.error("Erro ao carregar card de oportunidade criada:", e);
      }
    }

    revalidatePath("/kanban");

    return {
      success: true,
      opportunityId: newId as string,
      opportunity: opportunityCard,
    };
  } catch (err) {
    console.error("Erro inesperado em createOpportunityAction:", err);
    return {
      success: false,
      error: "Erro interno ao criar oportunidade.",
    };
  }
}

/**
 * Server Action: Edita os dados de uma oportunidade existente.
 */
export async function updateOpportunityAction(
  input: UpdateOpportunityInput,
): Promise<UpdateOpportunityResult> {
  const supabase = await createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "Sessão não autenticada.",
    };
  }

  const title = input.title?.trim();
  if (!title) {
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: "O título da oportunidade é obrigatório.",
    };
  }

  if (!input.opportunityId || !UUID_REGEX.test(input.opportunityId)) {
    return {
      success: false,
      code: "VALIDATION_ERROR",
      error: "Identificador da oportunidade é inválido.",
    };
  }

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "update_opportunity",
      {
        p_opportunity_id: input.opportunityId,
        p_title: title,
        p_description: input.description?.trim() || undefined,
        p_stage_id: input.stageId || undefined,
        p_contact_id: input.contactId || undefined,
        p_responsible_member_id: input.responsibleMemberId || undefined,
      },
    );

    if (rpcError) {
      console.error("Erro RPC update_opportunity:", rpcError);
      return {
        success: false,
        code: "INTERNAL_ERROR",
        error: "Falha ao atualizar oportunidade no banco de dados.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = rpcData as any;

    if (res?.status === "CONTACT_CHANGE_BLOCKED_BY_CONVERSATION") {
      return {
        success: false,
        code: "CONTACT_CHANGE_BLOCKED_BY_CONVERSATION",
        error: res.error || "Não é possível alterar o contato de uma oportunidade com conversa vinculada.",
      };
    }

    revalidatePath("/kanban");

    return {
      success: true,
      opportunityId: input.opportunityId,
    };
  } catch (err) {
    console.error("Erro inesperado em updateOpportunityAction:", err);
    return {
      success: false,
      code: "INTERNAL_ERROR",
      error: "Erro interno ao atualizar oportunidade.",
    };
  }
}

/**
 * Server Action: Arquiva logicamente uma oportunidade (restrito a OWNER).
 */
export async function archiveOpportunityAction(
  opportunityId: string,
): Promise<ArchiveOpportunityResult> {
  const supabase = await createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "Sessão não autenticada.",
    };
  }

  if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
    return {
      success: false,
      error: "Identificador da oportunidade é inválido.",
    };
  }

  try {
    const { error: rpcError } = await supabase.rpc(
      "archive_opportunity",
      {
        p_opportunity_id: opportunityId,
      },
    );

    if (rpcError) {
      console.error("Erro RPC archive_opportunity:", rpcError);
      if (rpcError.message?.includes("only_owner_can_archive_opportunity")) {
        return {
          success: false,
          code: "ONLY_OWNER_CAN_ARCHIVE",
          error: "Apenas o proprietário (OWNER) pode arquivar oportunidades.",
        };
      }
      return {
        success: false,
        code: "INTERNAL_ERROR",
        error: "Falha ao arquivar oportunidade no banco de dados.",
      };
    }

    revalidatePath("/kanban");

    return {
      success: true,
      opportunityId,
    };
  } catch (err) {
    console.error("Erro inesperado em archiveOpportunityAction:", err);
    return {
      success: false,
      code: "INTERNAL_ERROR",
      error: "Erro interno ao arquivar oportunidade.",
    };
  }
}

/**
 * Server Action: Resolve ou cria atomicamente a conversa comercial para a oportunidade.
 */
export async function openOrCreateOpportunityConversationAction(
  opportunityId: string,
): Promise<OpenOrCreateConversationResult> {
  const supabase = await createServerSupabaseClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return {
      success: false,
      code: "UNAUTHORIZED",
      error: "Sessão não autenticada.",
    };
  }

  if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
    return {
      success: false,
      code: "INTERNAL_ERROR",
      error: "Identificador de oportunidade inválido.",
    };
  }

  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "get_or_create_opportunity_conversation",
      {
        p_opportunity_id: opportunityId,
      },
    );

    if (rpcError) {
      console.error("Erro RPC get_or_create_opportunity_conversation:", rpcError);
      return {
        success: false,
        code: "INTERNAL_ERROR",
        error: "Falha ao resolver conversa para a oportunidade.",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = rpcData as any;

    if (res?.status === "NO_ELIGIBLE_CONVERSATION") {
      return {
        success: false,
        code: "NO_ELIGIBLE_CONVERSATION",
        error: "Não foi possível abrir a conversa. Verifique se este contato possui um telefone WhatsApp válido e se o WhatsApp está conectado.",
      };
    }

    if (!res?.conversation_id) {
      return {
        success: false,
        code: "INTERNAL_ERROR",
        error: "Não foi possível obter o ID da conversa.",
      };
    }

    return {
      success: true,
      status: res.status as "success" | "linked" | "created",
      conversationId: res.conversation_id as string,
    };
  } catch (err) {
    console.error("Erro inesperado em openOrCreateOpportunityConversationAction:", err);
    return {
      success: false,
      code: "INTERNAL_ERROR",
      error: "Erro interno ao processar abertura de conversa.",
    };
  }
}
