import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { KanbanStage } from "@/types/kanban";

export interface ContactSelectItem {
  id: string;
  displayName: string;
  classification: string;
}

export interface MemberSelectItem {
  id: string;
  displayName: string;
}

/**
 * Busca todas as etapas ativas do Kanban com suas oportunidades abertas (até 50 por etapa)
 * em uma única consulta otimizada via RPC get_kanban_board (evita N+1).
 */
export async function getKanbanBoardData(limitPerStage = 50): Promise<KanbanStage[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("get_kanban_board", {
    p_limit_per_stage: limitPerStage,
  });

  if (error) {
    console.error("Erro ao buscar dados do Kanban via RPC get_kanban_board:", error);
    return [];
  }

  if (!data || !Array.isArray(data)) {
    return [];
  }

  // data é um array JSON de estágios com cards
  return data as unknown as KanbanStage[];
}

/**
 * Busca contatos ativos para preenchimento do select no modal de criação.
 */
export async function getContactsForSelect(): Promise<ContactSelectItem[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("contacts")
    .select("id, display_name, classification")
    .eq("operational_status", "active")
    .order("display_name", { ascending: true })
    .limit(100);

  if (error || !data) {
    return [];
  }

  return data.map((c) => ({
    id: c.id,
    displayName: c.display_name,
    classification: c.classification,
  }));
}

/**
 * Busca membros ativos do workspace para selecionar o responsável no modal.
 */
export async function getWorkspaceMembersForSelect(): Promise<MemberSelectItem[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("workspace_members")
    .select("id, app_users(display_name)")
    .eq("status", "active")
    .order("id", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((m) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userObj = m.app_users as any;
    const name = typeof userObj === "object" && userObj !== null ? userObj.display_name : "Membro";

    return {
      id: m.id,
      displayName: name,
    };
  });
}
