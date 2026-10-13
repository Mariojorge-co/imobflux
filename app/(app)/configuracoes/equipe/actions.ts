"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createEmailSupabaseClient } from "@/lib/supabase/email";
import { logAuthFailure } from "@/lib/auth/email-flow";

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
  if (message.includes("team_member_not_removable")) {
    return "Este funcionário não pode ser removido (já removido ou fora da equipe).";
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
  return `${origin}/auth/confirm?next=/convite`;
}

async function recoveryRedirectUrl(next = "/redefinir-senha") {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (!origin) throw new Error("invalid_origin");
  return `${origin}/auth/confirm?next=${encodeURIComponent(next)}`;
}

async function sendAuthInvitation(admin: ReturnType<typeof createAdminSupabaseClient>, email: string, displayName: string) {
  try {
    const result = await admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name: displayName },
      redirectTo: await invitationRedirectUrl(),
    });
    if (result.error) logAuthFailure("team_invitation_send", result.error);
    return result;
  } catch {
    logAuthFailure("team_invitation_send");
    return null;
  }
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
  const invited = await sendAuthInvitation(admin, email, displayName);

  if (!invited || invited.error || !invited.data.user) {
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
  if (invitation.auth_user_id) {
    let recovery;
    try {
      recovery = await createEmailSupabaseClient().auth.resetPasswordForEmail(invitation.email, { redirectTo: await recoveryRedirectUrl("/convite") });
    } catch {
      logAuthFailure("team_invitation_resend");
      return { message: "Não foi possível solicitar o novo acesso agora. Tente novamente mais tarde.", status: "error" };
    }
    if (recovery.error) {
      logAuthFailure("team_invitation_resend", recovery.error);
      return { message: recovery.error.status === 429 ? "O serviço de e-mail limitou novas solicitações. Aguarde antes de reenviar." : "Não foi possível solicitar o novo acesso agora. Tente novamente mais tarde.", status: "error" };
    }
    const marked = await supabase.rpc("mark_team_invitation_resent", { p_member_id: memberId });
    if (marked.error) return { message: "O e-mail foi solicitado, mas o convite não pôde ser atualizado.", status: "warning" };
    revalidatePath("/configuracoes/equipe");
    return { message: "Novo acesso solicitado ao serviço de e-mail.", status: "success" };
  }
  const invited = await sendAuthInvitation(admin, invitation.email, invitation.display_name);
  if (!invited || invited.error || !invited.data.user) {
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

/** Remoção definitiva do vínculo (ou cancelamento de convite): acesso revogado, trabalho liberado, nada apagado. */
export async function removeMemberAction(memberId: string): Promise<TeamActionResult> {
  try {
    await assertTrustedServerActionOrigin();
    await requireOwnerAccess();
  } catch {
    return { message: "Você não tem permissão para administrar a equipe.", status: "error" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("remove_team_member", { p_member_id: memberId });
  if (error) return { message: friendlyDatabaseMessage(error.message), status: "error" };
  revalidatePath("/configuracoes/equipe");
  revalidatePath("/kanban");
  revalidatePath("/conversas");
  const result = data as { ended_conversation_assignments?: number; cleared_opportunities?: number; cleared_tasks?: number } | null;
  const freed = (result?.ended_conversation_assignments ?? 0) + (result?.cleared_opportunities ?? 0) + (result?.cleared_tasks ?? 0);
  return {
    message: freed > 0
      ? `Funcionário removido. ${freed} item(ns) ficaram sem responsável e aguardam reatribuição.`
      : "Funcionário removido.",
    status: "success",
  };
}
