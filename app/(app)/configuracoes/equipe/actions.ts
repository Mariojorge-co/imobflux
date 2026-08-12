"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type TeamActionResult = {
  message: string;
  status: "error" | "success" | "warning";
};

function text(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function friendlyDatabaseMessage(message: string) {
  if (message.includes("team_member_already_active")) {
    return "Este usuário já faz parte da equipe.";
  }
  if (message.includes("team_invitation_already_pending")) {
    return "Já existe um convite pendente para este e-mail.";
  }
  if (message.includes("team_member_inactive")) {
    return "Este funcionário está inativo. Use a ação Reativar funcionário.";
  }
  return "Não foi possível concluir a operação. Tente novamente.";
}

async function invitationRedirectUrl() {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (!origin) throw new Error("invalid_origin");
  return `${origin}/convite`;
}

export async function inviteMemberAction(formData: FormData): Promise<TeamActionResult> {
  try {
    await assertTrustedServerActionOrigin();
    await requireOwnerAccess();
  } catch {
    return { message: "Você não tem permissão para administrar a equipe.", status: "error" };
  }

  const displayName = text(formData, "displayName");
  const email = text(formData, "email").toLocaleLowerCase("en-US");
  if (displayName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { message: "Informe um nome e um e-mail válidos.", status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const prepared = await supabase.rpc("prepare_team_invitation", {
    p_display_name: displayName,
    p_email: email,
  });

  if (prepared.error || !prepared.data) {
    return {
      message: friendlyDatabaseMessage(prepared.error?.message ?? ""),
      status: "error",
    };
  }

  const invitation = prepared.data as { member_id: string };
  const admin = createAdminSupabaseClient();
  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
    redirectTo: await invitationRedirectUrl(),
  });

  if (invited.error || !invited.data.user) {
    revalidatePath("/configuracoes/equipe");
    return {
      message: "Convite criado, mas a entrega do e-mail não foi confirmada. Você poderá reenviar pela lista.",
      status: "warning",
    };
  }

  const binding = await admin.rpc("bind_team_invitation_auth_identity", {
    p_auth_user_id: invited.data.user.id,
    p_member_id: invitation.member_id,
  });

  revalidatePath("/configuracoes/equipe");
  if (binding.error) {
    return {
      message: "Convite criado, mas a identidade ainda não foi vinculada. Reenvie o convite antes da aceitação.",
      status: "warning",
    };
  }

  return {
    message: "Convite criado. A entrega depende da configuração de e-mail do ambiente.",
    status: "success",
  };
}

export async function resendInviteAction(memberId: string): Promise<TeamActionResult> {
  try {
    await assertTrustedServerActionOrigin();
    await requireOwnerAccess();
  } catch {
    return { message: "Você não tem permissão para administrar a equipe.", status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const pending = await supabase.rpc("get_pending_team_invitation", { p_member_id: memberId });
  const invitation = (pending.data?.[0] ?? null) as {
    auth_user_id: string | null;
    display_name: string;
    email: string;
    member_id: string;
  } | null;

  if (pending.error || !invitation) {
    return { message: "Este convite não está mais pendente.", status: "error" };
  }

  const admin = createAdminSupabaseClient();
  const invited = await admin.auth.admin.inviteUserByEmail(invitation.email, {
    data: { display_name: invitation.display_name },
    redirectTo: await invitationRedirectUrl(),
  });
  if (invited.error || !invited.data.user) {
    return { message: "Não foi possível confirmar a entrega do novo convite.", status: "error" };
  }

  const binding = await admin.rpc("bind_team_invitation_auth_identity", {
    p_auth_user_id: invited.data.user.id,
    p_member_id: memberId,
  });
  if (binding.error) {
    return { message: "Não foi possível vincular a identidade do convite.", status: "error" };
  }

  const marked = await supabase.rpc("mark_team_invitation_resent", { p_member_id: memberId });
  if (marked.error) {
    return { message: "O e-mail foi solicitado, mas o convite não pôde ser atualizado.", status: "warning" };
  }

  revalidatePath("/configuracoes/equipe");
  return { message: "Novo convite solicitado ao serviço de e-mail.", status: "success" };
}

export async function deactivateMemberAction(memberId: string): Promise<TeamActionResult> {
  try {
    await assertTrustedServerActionOrigin();
    await requireOwnerAccess();
  } catch {
    return { message: "Você não tem permissão para administrar a equipe.", status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("deactivate_team_member", { p_member_id: memberId });
  if (error) return { message: friendlyDatabaseMessage(error.message), status: "error" };
  revalidatePath("/configuracoes/equipe");
  return { message: "Acesso do funcionário desativado.", status: "success" };
}

export async function reactivateMemberAction(memberId: string): Promise<TeamActionResult> {
  try {
    await assertTrustedServerActionOrigin();
    await requireOwnerAccess();
  } catch {
    return { message: "Você não tem permissão para administrar a equipe.", status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("reactivate_team_member", { p_member_id: memberId });
  if (error) return { message: friendlyDatabaseMessage(error.message), status: "error" };
  revalidatePath("/configuracoes/equipe");
  return { message: "Funcionário reativado.", status: "success" };
}
