"use server";

import { redirect } from "next/navigation";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getPendingInvitationForUser } from "@/lib/auth/invitation";

export type InvitationActionState = {
  message: string;
  status: "error" | "idle";
};

export async function continueInvitationAction() {
  await assertTrustedServerActionOrigin();
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/auth/confirm?resume=1");
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

  if (password.length < 8) {
    return { message: "A senha deve ter pelo menos 8 caracteres.", status: "error" };
  }
  if (password !== confirmation) {
    return { message: "As senhas não coincidem.", status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const user = await supabase.auth.getUser();
  if (user.error || !user.data.user) {
    return { message: "O convite não é mais válido. Solicite um novo convite.", status: "error" };
  }
  if (!user.data.user.email || !(await getPendingInvitationForUser(user.data.user.id, user.data.user.email))) {
    await supabase.auth.signOut({ scope: "local" });
    return { message: "Este convite não é válido para a conta atual.", status: "error" };
  }

  const passwordUpdate = await supabase.auth.updateUser({ password });
  if (passwordUpdate.error) {
    return { message: "Não foi possível definir sua senha.", status: "error" };
  }

  const acceptance = await supabase.rpc("accept_team_invitation");
  if (acceptance.error) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      message: acceptance.error.message.includes("expired")
        ? "Este convite expirou. Peça ao responsável para reenviar."
        : "Este convite é inválido ou já foi utilizado.",
      status: "error",
    };
  }

  redirect("/prioridades");
}
