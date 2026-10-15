import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type SlaConversationRow = {
  conversation_id: string;
  contact_id: string | null;
  participant_name: string | null;
  started_at: string;
  sla_direction: string;
  sla_at: string;
};

/**
 * Todas as conversas que têm prazo (individuais, abertas, sem prazo pausado/desativado, fora a conversa da pessoa
 * consigo mesma) com a base do contador: o painel de Prioridades usa isto em vez de só as 50 mais recentes.
 */
export async function getSlaConversations(limit = 500): Promise<SlaConversationRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_sla_conversations", { p_limit: limit });
  if (error) throw new Error("Não foi possível carregar as conversas com prazo.");
  return (Array.isArray(data) ? data : []) as SlaConversationRow[];
}
