/** Tradução dos erros do banco (administração de equipe) para mensagens que o usuário entende. */
export function friendlyTeamError(message: string | null | undefined): string {
  const text = message ?? "";
  if (text.includes("team_member_already_active")) {
    return "Este usuário já faz parte da equipe.";
  }
  if (text.includes("team_invitation_already_pending")) {
    return "Já existe um convite pendente para este e-mail.";
  }
  if (text.includes("team_identity_unavailable")) {
    return "Este e-mail pertence a uma conta que está ativa em outro workspace ou foi desativada, então não pode ser convidado aqui.";
  }
  if (text.includes("team_member_not_removable")) {
    return "Este funcionário não pode ser removido (já removido ou fora da equipe).";
  }
  if (text.includes("team_member_inactive")) {
    return "Este funcionário está inativo. Use a ação Reativar funcionário.";
  }
  return "Não foi possível concluir a operação. Tente novamente.";
}

/**
 * Texto exibido depois de convidar alguém cuja identidade já existia (ex.: funcionário removido e
 * reconvidado): o acesso dessa pessoa já existe, então ela recebe um e-mail para entrar de novo e aceitar.
 */
export const REINVITE_SUCCESS_MESSAGE =
  "Convite criado. Como essa pessoa já tinha acesso, enviamos um e-mail para ela entrar e aceitar o convite.";
