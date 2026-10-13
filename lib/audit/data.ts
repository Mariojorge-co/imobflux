import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuditEventRow } from "@/lib/audit/labels";
import { dayAfterIso, dayStartIso, type AuditFilters } from "@/lib/audit/query";

export type AuditPage = {
  events: AuditEventRow[];
  hasMore: boolean;
  /** id do membro -> nome, de todos os citados nos eventos (inclui removidos); só do próprio workspace. */
  memberNames: Record<string, string>;
};

export type TeamNameEntry = { id: string; name: string };

/** Uma página da auditoria (somente OWNER; o banco recusa qualquer outro papel). */
export async function getAuditPage(filters: AuditFilters, limit = 50): Promise<AuditPage> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_audit_events", {
    p_category: filters.category ?? undefined,
    p_actor_member_id: filters.actor ?? undefined,
    p_from: filters.from ? dayStartIso(filters.from) : undefined,
    p_to: filters.to ? dayAfterIso(filters.to) : undefined,
    p_cursor_ts: filters.cursorTs ?? undefined,
    p_cursor_id: filters.cursorId ?? undefined,
    p_limit: limit,
  });
  if (error) throw new Error("Não foi possível carregar a auditoria.");
  const result = data as unknown as { events?: AuditEventRow[]; has_more?: boolean; member_names?: Record<string, string> } | null;
  return { events: result?.events ?? [], hasMore: Boolean(result?.has_more), memberNames: result?.member_names ?? {} };
}

/** Nomes dos membros (para o filtro "pessoa" e para traduzir ids dentro dos eventos). */
export async function getTeamNames(): Promise<TeamNameEntry[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_members");
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ member_id: string; display_name: string }>).map((member) => ({ id: member.member_id, name: member.display_name }));
}
