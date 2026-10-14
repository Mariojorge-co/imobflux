import "server-only";

import * as React from "react";
import { redirect } from "next/navigation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Dedupe por requisição (React cache): layout e página consultam o mesmo acesso na mesma renderização.
 * Fora de uma renderização do servidor (testes, outros contextos) devolve a função sem cache.
 */
function perRequest<Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>): (...args: Args) => Promise<Result> {
  const cacheFn = (React as unknown as { cache?: <T>(f: T) => T }).cache;
  return typeof cacheFn === "function" ? cacheFn(fn) : fn;
}

export type ActiveAccessContext = {
  appUserId: string;
  authUserId: string;
  displayName: string;
  memberId: string;
  role: "owner" | "attendant";
  workspaceId: string;
};

export const getAuthenticatedUser = perRequest(async () => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
});

export async function getActiveAccessForAuthUser(
  authUserId: string,
): Promise<ActiveAccessContext | null> {
  const admin = createAdminSupabaseClient();
  // Uma única consulta (era uma sequência de três): vínculo ativo + usuário + espaço de trabalho, pelo cliente administrativo.
  // As mesmas regras de antes: usuário ativo, vínculo ativo como OWNER/ATTENDANT, espaço de trabalho ativo.
  const { data: membership, error } = await admin
    .from("workspace_members")
    .select(
      "id, role, status, workspace_id, app_users!fk_workspace_members_user!inner(id, display_name, status, auth_user_id), workspaces!fk_workspace_members_workspace(id, status)",
    )
    .eq("app_users.auth_user_id", authUserId)
    .eq("status", "active")
    .in("role", ["owner", "attendant"])
    .limit(1)
    .maybeSingle();

  if (error || !membership) {
    return null;
  }

  const appUser = membership.app_users;
  const workspace = membership.workspaces;

  if (!appUser || appUser.status !== "active") {
    return null;
  }

  if (!workspace || workspace.status !== "active") {
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

export const requireActiveAccess = perRequest(async () => {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  const access = await getActiveAccessForAuthUser(user.id);

  if (!access) {
    redirect("/login?reason=access_denied");
  }

  return access;
});

export async function requireOwnerAccess() {
  const access = await requireActiveAccess();

  if (access.role !== "owner") {
    redirect("/prioridades?reason=owner_required");
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
