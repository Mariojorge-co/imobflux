"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseSlaSettings, validateSlaSettings } from "@/lib/conversations/sla-settings";
import type { SlaSettings } from "@/lib/conversations/sla";

export type UpdateSlaSettingsResult = { success: true; settings: SlaSettings } | { success: false; error: string };

/** Só o OWNER altera os limites (o banco confere de novo). Os valores são validados com as mesmas regras do banco. */
export async function updateSlaSettingsAction(settings: SlaSettings): Promise<UpdateSlaSettingsResult> {
  const check = validateSlaSettings(settings);
  if (!check.ok) return { success: false, error: check.error };
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("update_sla_settings", {
      p_team_green: settings.teamGreenUntil,
      p_team_yellow: settings.teamYellowUntil,
      p_team_orange: settings.teamOrangeUntil,
      p_team_red: settings.teamRedUntil,
      p_followup1: settings.followup1,
      p_followup2: settings.followup2,
      p_followup3: settings.followup3,
    });
    if (error) {
      if (error.message?.includes("sla_not_authorized")) return { success: false, error: "Só o proprietário pode alterar os prazos." };
      if (error.message?.includes("sla_limits_invalid")) return { success: false, error: "Os valores não são válidos: cada nível precisa ser maior que o anterior, de 1 minuto a 30 dias." };
      return { success: false, error: "Não foi possível salvar os prazos. Tente novamente." };
    }
    // As telas leem os limites no layout: recarrega para todas passarem a usar os novos valores.
    revalidatePath("/", "layout");
    return { success: true, settings: parseSlaSettings(data) };
  } catch (error) {
    console.error("Erro em updateSlaSettingsAction:", (error as { code?: string } | null)?.code ?? "desconhecido");
    return { success: false, error: "Falha ao salvar os prazos." };
  }
}
