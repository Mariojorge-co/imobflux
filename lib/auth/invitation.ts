import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export type PendingInvitationContext = {
  appUserId: string;
  memberId: string;
  workspaceId: string;
  invitedEmail: string;
  invitationExpiresAt: string;
};

export type InvitationLookup =
  | { status: "pending"; invitation: PendingInvitationContext }
  | { status: "expired" | "not_found" | "technical" };

export async function lookupInvitationForUser(authUserId: string, email: string): Promise<InvitationLookup> {
  try {
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
      .limit(2)
      .maybeSingle();

    if (error) return { status: "technical" };
    if (!data) return { status: "not_found" };
    if (Array.isArray(data.workspace_members) && data.workspace_members.length !== 1) return { status: "technical" };
    const membership = Array.isArray(data.workspace_members) ? data.workspace_members[0] : data.workspace_members;
    if (!membership?.invited_email_normalized || !membership.invitation_expires_at) return { status: "technical" };
    const expiresAt = new Date(membership.invitation_expires_at).getTime();
    if (!Number.isFinite(expiresAt)) return { status: "technical" };
    if (expiresAt <= Date.now()) return { status: "expired" };
    return {
      status: "pending",
      invitation: {
        appUserId: data.id, memberId: membership.id, workspaceId: membership.workspace_id,
        invitedEmail: membership.invited_email_normalized, invitationExpiresAt: membership.invitation_expires_at,
      },
    };
  } catch {
    return { status: "technical" };
  }
}

export async function getPendingInvitationForUser(authUserId: string, email: string) {
  const result = await lookupInvitationForUser(authUserId, email);
  return result.status === "pending" ? result.invitation : null;
}
