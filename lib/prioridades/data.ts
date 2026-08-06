import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { PrioridadesDashboardResult } from "@/types/prioridades";

export async function getPrioridadesDashboard(): Promise<PrioridadesDashboardResult> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("get_prioridades_dashboard");

  if (error) {
    throw new Error("Não foi possível carregar o dashboard de prioridades.");
  }

  // Cast o resultado JSON para o tipo esperado. O PostgreSQL retorna null se vazio,
  // ou objeto JSON estruturado.
  return (
    (data as unknown as PrioridadesDashboardResult) ?? {
      new_contacts: { count: 0, items: [] },
      pending_qualification: { count: 0, items: [] },
      stale_leads: { count: 0, items: [] },
      without_phone: { count: 0, items: [] },
    }
  );
}
