"use server";

import { passwordUpdateErrorMessage } from "@/lib/auth/password-errors";
import { redirect } from "next/navigation";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { lookupInvitationForUser } from "@/lib/auth/invitation";
import { clearConfirmedFlow, getConfirmedFlow, markFlowPasswordDefined } from "@/lib/auth/confirmed-flow";
import { continueEmailFlow } from "@/lib/auth/continue-email-flow";
import { authFlowErrorMessage, classifyAuthFailure, logAuthFailure } from "@/lib/auth/email-flow";
import { getActiveAccessForAuthUser } from "@/lib/auth/dal";

export type InvitationActionState = {
  message: string;
  status: "error" | "idle";
};

export async function continueInvitationAction() {
  await continueEmailFlow();
}

export async function acceptInvitationAction(
  _previous: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  try {
    await assertTrustedServerActionOrigin();
  } catch {
    return { message: "Operação não permitida.", status: "error" };
  }

  const passwordValue = formData.get("password");
  const confirmationValue = formData.get("passwordConfirmation");
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const confirmation = typeof confirmationValue === "string" ? confirmationValue : "";

  const supabase = await createServerSupabaseClient();
  try {
    const user = await supabase.auth.getUser();
    if (user.error || !user.data.user?.email) return { message: authFlowErrorMessage(user.error ? classifyAuthFailure(user.error) : "invalid"), status: "error" };
    const flow = await getConfirmedFlow(supabase, user.data.user.id);
    if (!flow) return { message: authFlowErrorMessage("invalid"), status: "error" };
    const lookup = await lookupInvitationForUser(user.data.user.id, user.data.user.email);
    let reconciled = false;
    if (lookup.status === "not_found" && flow.phase === "password_defined" && flow.memberId && flow.workspaceId) {
      const access = await getActiveAccessForAuthUser(user.data.user.id);
      reconciled = !!access && access.memberId === flow.memberId && access.workspaceId === flow.workspaceId && access.role === "attendant";
    }
    if (lookup.status !== "pending" && !reconciled) {
      return { message: authFlowErrorMessage(lookup.status === "expired" ? "invitation_expired" : lookup.status === "technical" ? "technical" : "invalid"), status: "error" };
    }
    if (lookup.status === "pending") {
      if (flow.phase !== "password_defined") {
        if (password.length < 8) return { message: "A senha deve ter pelo menos 8 caracteres.", status: "error" };
        if (password !== confirmation) return { message: "As senhas não coincidem.", status: "error" };
        const passwordUpdate = await supabase.auth.updateUser({ password });
        if (passwordUpdate.error) {
          logAuthFailure("invitation_password", passwordUpdate.error);
          return { message: passwordUpdateErrorMessage(passwordUpdate.error), status: "error" };
        }
        await markFlowPasswordDefined(flow, { memberId: lookup.invitation.memberId, workspaceId: lookup.invitation.workspaceId });
      }
      let acceptance;
      try {
        acceptance = await supabase.rpc("accept_team_invitation");
      } catch {
        acceptance = { error: { message: "team_invitation_confirmation_unavailable" } };
      }
      if (acceptance.error) {
        // A response can be lost after commit: never undo identity or membership.
        const access = await getActiveAccessForAuthUser(user.data.user.id);
        if (!access || access.memberId !== lookup.invitation.memberId || access.workspaceId !== lookup.invitation.workspaceId || access.role !== "attendant") {
          logAuthFailure("invitation_accept");
          return {
            message: acceptance.error.message.includes("team_invitation_expired")
              ? authFlowErrorMessage("invitation_expired")
              : "Sua senha foi definida, mas não foi possível confirmar a ativação. Tente ativar seu acesso novamente.",
            status: "error",
          };
        }
      }
    }
    await clearConfirmedFlow();
  } catch {
    logAuthFailure("invitation_accept");
    return { message: authFlowErrorMessage("technical"), status: "error" };
  }

  redirect("/prioridades");
}
