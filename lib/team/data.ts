import "server-only";

import { requireOwnerAccess } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type TeamMember = {
  activatedAt: string | null;
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  invitedAt: string | null;
  role: "owner" | "attendant";
  status: "invited" | "active" | "suspended";
};

type TeamMemberRow = {
  activated_at: string | null;
  created_at: string;
  display_name: string;
  email: string;
  invited_at: string | null;
  member_id: string;
  member_role: TeamMember["role"];
  member_status: TeamMember["status"];
};

export async function getTeamMembers(): Promise<TeamMember[]> {
  await requireOwnerAccess();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_team_members");

  if (error) {
    throw new Error("Não foi possível carregar a equipe.");
  }

  return ((data ?? []) as TeamMemberRow[]).map((member) => ({
    activatedAt: member.activated_at,
    createdAt: member.created_at,
    displayName: member.display_name,
    email: member.email,
    id: member.member_id,
    invitedAt: member.invited_at,
    role: member.member_role,
    status: member.member_status,
  }));
}
