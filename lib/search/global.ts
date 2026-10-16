"use server";

import { getOptionalActiveAccess } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { GLOBAL_SEARCH_MIN, GLOBAL_SEARCH_PAGE } from "@/lib/search/highlight";

export type GlobalSearchItem = {
  kind: "message" | "contact";
  conversation_id: string;
  message_id: string | null;
  occurred_at: string | null;
  participant_name: string | null;
  participant_phone: string | null;
  conversation_type: string;
  archived: boolean;
  snippet: string | null;
};

export type GlobalSearchResult =
  | { success: true; items: GlobalSearchItem[]; hasMore: boolean; total: number }
  | { success: false; error: string };

/** Busca em todas as conversas que a pessoa enxerga (a RLS do banco decide). Só o código do erro vai para o log. */
export async function searchGlobalAction(query: string, offset = 0): Promise<GlobalSearchResult> {
  const term = String(query ?? "").trim().slice(0, 100);
  if (term.length < GLOBAL_SEARCH_MIN) return { success: true, items: [], hasMore: false, total: 0 };
  const safeOffset = Number.isInteger(offset) && offset >= 0 && offset <= 5000 ? offset : 0;
  try {
    const access = await getOptionalActiveAccess();
    if (!access) return { success: false, error: "Sessão expirada. Faça login novamente." };
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("search_global", {
      p_query: term,
      p_limit: GLOBAL_SEARCH_PAGE,
      p_offset: safeOffset,
    });
    if (error) {
      console.error(`Erro em searchGlobalAction (código ${error.code ?? "desconhecido"})`);
      return { success: false, error: "Não foi possível buscar agora. Tente novamente." };
    }
    const payload = data as unknown as { results?: GlobalSearchItem[]; has_more?: boolean; total?: number } | null;
    return { success: true, items: payload?.results ?? [], hasMore: Boolean(payload?.has_more), total: Number(payload?.total ?? 0) };
  } catch {
    console.error("Erro em searchGlobalAction (código EXCEPTION)");
    return { success: false, error: "Não foi possível buscar agora. Tente novamente." };
  }
}
