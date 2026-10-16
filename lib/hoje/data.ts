import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { EMPTY_OVERVIEW, type TodayOverview } from "./model";

/** Dados do painel "Hoje" numa só leitura; a RLS decide o que a pessoa vê. */
export async function getTodayOverview(limit = 500): Promise<TodayOverview> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_today_overview", { p_limit: limit });
  if (error) throw new Error("Não foi possível carregar o painel de hoje.");
  const result = data as unknown as Partial<TodayOverview> | null;
  return {
    timezone: result?.timezone ?? null,
    day_start: result?.day_start ?? null,
    conversations: result?.conversations ?? [],
    counters: { ...EMPTY_OVERVIEW.counters, ...(result?.counters ?? {}) },
  };
}
