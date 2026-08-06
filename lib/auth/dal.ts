import "server-only";

import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ActiveAccessContext = {
  appUserId: string;
  authUserId: string;
  displayName: string;
  memberId: string;
  role: "owner" | "attendant";
  workspaceId: string;
};

export async function getAuthenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function getActiveAccessForAuthUser(
  authUserId: string,
): Promise<ActiveAccessContext | null> {
  const admin = createAdminSupabaseClient();
  const { data: appUser, error: appUserError } = await admin
    .from("app_users")
    .select("id, display_name, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (appUserError || !appUser || appUser.status !== "active") {
    return null;
  }

  const { data: membership, error: membershipError } = await admin
    .from("workspace_members")
    .select("id, role, status, workspace_id")
    .eq("user_id", appUser.id)
    .eq("status", "active")
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) {
    return null;
  }

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("id, status")
    .eq("id", membership.workspace_id)
    .maybeSingle();

  if (workspaceError || !workspace || workspace.status !== "active") {
    return null;
  }

  return {
    appUserId: appUser.id,
    authUserId,
    displayName: appUser.display_name,
    memberId: membership.id,
    role: membership.role as "attendant" | "owner",
    workspaceId: workspace.id,
  };
}

export async function getOptionalActiveAccess() {
  const user = await getAuthenticatedUser();
  return user ? getActiveAccessForAuthUser(user.id) : null;
}

export async function requireActiveAccess() {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  const access = await getActiveAccessForAuthUser(user.id);

  if (!access) {
    redirect("/login?reason=access_denied");
  }

  return access;
}

export async function isInitialBootstrapOpen() {
  const admin = createAdminSupabaseClient();
  const { count, error } = await admin
    .from("workspaces")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new Error("Não foi possível verificar a configuração inicial.");
  }

  return count === 0;
}
