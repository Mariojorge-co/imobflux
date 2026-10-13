import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveHistoryImport, type HistoryImportView } from "@/lib/whatsapp/history-status";

export type WhatsappChannelStatus = {
  id: string;
  instance: string;
  status: "configured" | "active" | "paused" | "disconnected" | "replaced";
  phone: string | null;
  activatedAt: string | null;
  disconnectedAt: string | null;
  /** Situação da importação do histórico recente (só existe para conexão pareada). */
  historyImport: HistoryImportView;
  historyStartedAt: string | null;
};

/**
 * Conexão de WhatsApp do workspace (a RLS limita a leitura ao OWNER). Prefere a ativa; sem ela,
 * devolve a mais recente que ainda não foi substituída.
 */
export async function getWhatsappChannelStatus(): Promise<WhatsappChannelStatus | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("channel_connections")
    .select("id, external_account_id, status, external_phone_normalized, activated_at, disconnected_at, created_at, history_import_status, history_import_started_at, history_import_finished_at, history_imported_count, history_import_error")
    .eq("provider", "whatsapp")
    .neq("status", "replaced")
    .order("created_at", { ascending: false });

  if (error || !data?.length) return null;
  const chosen = data.find((row) => row.status === "active") ?? data[0];
  return {
    id: chosen.id,
    instance: chosen.external_account_id,
    status: chosen.status as WhatsappChannelStatus["status"],
    phone: chosen.external_phone_normalized,
    activatedAt: chosen.activated_at,
    disconnectedAt: chosen.disconnected_at,
    historyStartedAt: chosen.history_import_started_at,
    historyImport: chosen.status === "active"
      ? resolveHistoryImport({
          status: chosen.history_import_status,
          startedAt: chosen.history_import_started_at,
          finishedAt: chosen.history_import_finished_at,
          importedCount: chosen.history_imported_count,
          error: chosen.history_import_error,
        })
      : { state: "none" },
  };
}
