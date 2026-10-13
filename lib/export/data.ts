import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ExportCounts = { contacts: number | null; opportunities: number | null };

/** Totais para avisar, antes do download, quando a exportação vai ser truncada (a RLS do OWNER enxerga tudo). */
export async function getExportCounts(): Promise<ExportCounts> {
  const supabase = await createServerSupabaseClient();
  const [contacts, opportunities] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase.from("opportunities").select("id", { count: "exact", head: true }),
  ]);
  return {
    contacts: contacts.error ? null : (contacts.count ?? 0),
    opportunities: opportunities.error ? null : (opportunities.count ?? 0),
  };
}
