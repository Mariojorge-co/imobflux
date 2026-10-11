"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createEmailSupabaseClient } from "@/lib/supabase/email";
import { clearConfirmedFlow, getConfirmedFlow } from "@/lib/auth/confirmed-flow";
import { lookupInvitationForUser } from "@/lib/auth/invitation";
import { authFlowErrorMessage, classifyAuthFailure, logAuthFailure } from "@/lib/auth/email-flow";

export type PasswordResetActionState = { message: string; status: "error" | "idle" };

async function publicOrigin() {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin") || `https://${requestHeaders.get("host")}`;
  return origin.replace(/\/$/, "");
}

export async function requestPasswordResetAction(
  _previous: PasswordResetActionState,
  formData: FormData,
): Promise<PasswordResetActionState> {
  try { await assertTrustedServerActionOrigin(); } catch { return { message: "Operação não permitida.", status: "error" }; }
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")).trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { message: "Se houver uma conta correspondente, enviaremos instruções para redefinir a senha.", status: "idle" };
  }
  try {
    const sender = createEmailSupabaseClient();
    const { error } = await sender.auth.resetPasswordForEmail(email, { redirectTo: `${await publicOrigin()}/auth/confirm?next=/redefinir-senha` });
    if (error) logAuthFailure("password_recovery_send", error);
  } catch { logAuthFailure("password_recovery_send"); }
  return { message: "Se houver uma conta correspondente, enviaremos instruções para redefinir a senha.", status: "idle" };
}

export async function updatePasswordAction(
  _previous: PasswordResetActionState,
  formData: FormData,
): Promise<PasswordResetActionState> {
  try { await assertTrustedServerActionOrigin(); } catch { return { message: "Operação não permitida.", status: "error" }; }
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : "";
  const confirmation = typeof formData.get("passwordConfirmation") === "string" ? String(formData.get("passwordConfirmation")) : "";
  if (password.length < 8) return { message: "A senha deve ter pelo menos 8 caracteres.", status: "error" };
  if (password !== confirmation) return { message: "As senhas não coincidem.", status: "error" };
  const supabase = await createServerSupabaseClient();
  let invitationPending = false;
  try {
    const { data, error } = await supabase.auth.getUser();
    const user = data.user;
    if (error || !user?.email) return { message: authFlowErrorMessage(error ? classifyAuthFailure(error) : "invalid"), status: "error" };
    const flow = await getConfirmedFlow(supabase, user.id);
    if (!flow || flow.type !== "recovery") return { message: authFlowErrorMessage("invalid"), status: "error" };
    const lookup = await lookupInvitationForUser(user.id, user.email);
    if (lookup.status === "technical" || lookup.status === "expired") {
      return { message: authFlowErrorMessage(lookup.status === "expired" ? "invitation_expired" : "technical"), status: "error" };
    }
    invitationPending = lookup.status === "pending";
    if (!invitationPending) {
      const update = await supabase.auth.updateUser({ password });
      if (update.error) {
        logAuthFailure("password_recovery_update", update.error);
        return { message: "Não foi possível atualizar a senha. Tente novamente.", status: "error" };
      }
      await clearConfirmedFlow();
      const signOut = await supabase.auth.signOut({ scope: "local" });
      if (signOut.error) logAuthFailure("password_recovery_sign_out", signOut.error);
    }
  } catch {
    logAuthFailure("password_recovery_update");
    return { message: authFlowErrorMessage("technical"), status: "error" };
  }
  if (invitationPending) redirect("/convite");
  redirect("/login?reason=password_updated");
}
