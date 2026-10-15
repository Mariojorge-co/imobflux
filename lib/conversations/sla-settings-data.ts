import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DEFAULT_SLA_SETTINGS, type SlaSettings } from "@/lib/conversations/sla";
import { parseSlaSettings } from "@/lib/conversations/sla-settings";

/** Limites de prazo do workspace de quem está logado (padrões se nada foi configurado ou se a leitura falhar). */
export async function getSlaSettings(): Promise<SlaSettings> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("get_sla_settings");
    if (error) return DEFAULT_SLA_SETTINGS;
    return parseSlaSettings(data);
  } catch {
    return DEFAULT_SLA_SETTINGS;
  }
}
