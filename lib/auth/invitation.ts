import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type PendingInvitationContext = {
  appUserId: string;
  memberId: string;
  workspaceId: string;
  invitedEmail: string;
  invitationExpiresAt: string;
};

export async function getPendingInvitationForUser(authUserId: string, email: string) {
  const admin = createAdminSupabaseClient();
  const normalizedEmail = email.trim().toLocaleLowerCase("en-US");
  const { data, error } = await admin
    .from("app_users")
    .select("id, workspace_members!inner(id, workspace_id, role, status, invited_email_normalized, invitation_expires_at)")
    .eq("auth_user_id", authUserId)
    .eq("status", "active")
    .eq("workspace_members.role", "attendant")
    .eq("workspace_members.status", "invited")
    .eq("workspace_members.invited_email_normalized", normalizedEmail)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const membership = Array.isArray(data.workspace_members)
    ? data.workspace_members[0]
    : data.workspace_members;
  if (!membership?.invited_email_normalized || !membership.invitation_expires_at || new Date(membership.invitation_expires_at).getTime() <= Date.now()) {
    return null;
  }
  return {
    appUserId: data.id,
    memberId: membership.id,
    workspaceId: membership.workspace_id,
    invitedEmail: membership.invited_email_normalized,
    invitationExpiresAt: membership.invitation_expires_at,
  } satisfies PendingInvitationContext;
}
