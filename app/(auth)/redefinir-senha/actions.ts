"use server";

import { redirect } from "next/navigation";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { getAuthenticatedUser } from "@/lib/auth/dal";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type PasswordResetActionState = { message: string; status: "error" | "idle" };

async function publicOrigin() {
  const { headers } = await import("next/headers");
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
  const supabase = await createServerSupabaseClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await publicOrigin()}/auth/confirm?type=recovery&next=/redefinir-senha` });
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
  const user = await getAuthenticatedUser();
  if (!user) return { message: "O link de recuperação não é mais válido.", status: "error" };
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { message: "Não foi possível atualizar a senha.", status: "error" };
  redirect("/login?reason=password_updated");
}
