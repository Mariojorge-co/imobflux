import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type WhatsappChannelStatus = {
  id: string;
  instance: string;
  status: "configured" | "active" | "paused" | "disconnected" | "replaced";
  phone: string | null;
  activatedAt: string | null;
  disconnectedAt: string | null;
};

/**
 * Conexão de WhatsApp do workspace (a RLS limita a leitura ao OWNER). Prefere a ativa; sem ela,
 * devolve a mais recente que ainda não foi substituída.
 */
export async function getWhatsappChannelStatus(): Promise<WhatsappChannelStatus | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("channel_connections")
    .select("id, external_account_id, status, external_phone_normalized, activated_at, disconnected_at, created_at")
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
  };
}
