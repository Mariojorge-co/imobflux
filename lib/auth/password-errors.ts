/**
 * Mensagem exibida quando o Auth recusa a definição de senha no aceite do convite.
 * Caso importante: quem volta depois de ter sido removido (reconvite) já tem uma senha, e o Auth recusa
 * "a mesma senha de antes". Os demais erros continuam genéricos, para não revelar detalhes do Auth.
 */
export function passwordUpdateErrorMessage(error: { code?: string | null; message?: string | null } | null | undefined): string {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "same_password" || /different from the old password/i.test(message)) {
    return "Escolha uma senha diferente da anterior: esta conta já tinha uma senha.";
  }
  return "Não foi possível definir sua senha. Tente novamente.";
}
