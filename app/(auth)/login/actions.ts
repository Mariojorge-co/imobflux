"use server";

import { redirect } from "next/navigation";
import { getActiveAccessForAuthUser } from "@/lib/auth/dal";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import {
  type AuthActionState,
  validateLoginForm,
} from "@/lib/auth/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const invalidCredentialsMessage = "E-mail ou senha inválidos.";

export async function loginAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    await assertTrustedServerActionOrigin();
  } catch {
    return { message: "Operação não permitida.", status: "error" };
  }

  const input = validateLoginForm(formData);

  if (!input) {
    return { message: invalidCredentialsMessage, status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword(input);

  if (error || !data.user) {
    return { message: invalidCredentialsMessage, status: "error" };
  }

  const access = await getActiveAccessForAuthUser(data.user.id);

  if (!access) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      message: "Esta conta não possui acesso ativo ao ImobFlux.",
      status: "error",
    };
  }

  redirect("/prioridades");
}

export async function logoutAction() {
  await assertTrustedServerActionOrigin();
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
