export type ConversationAssignee = { member_id: string; display_name: string | null; assigned_at?: string };

export type DirectoryMember = { member_id: string; display_name: string; role: "owner" | "attendant" };

/** Tradução dos erros do banco para mensagens que o usuário entende (sem expor códigos técnicos). */
export function assignmentErrorMessage(message: string | null | undefined): string {
  const text = message ?? "";
  if (text.includes("conversation_not_available")) return "Você não tem acesso a esta conversa.";
  if (text.includes("assignee_not_active")) return "Este membro não está ativo na equipe.";
  if (text.includes("assignee_cannot_access_conversation")) {
    return "Esta conversa é restrita ao proprietário (privada ou grupo não liberado). Só o proprietário pode ser responsável por ela.";
  }
  if (text.includes("assignment_not_found")) return "Este membro já não é responsável por esta conversa.";
  if (text.includes("assignment_invalid")) return "Escolha um membro diferente do responsável atual.";
  return "Não foi possível alterar o responsável. Tente novamente.";
}

/**
 * Membros que podem receber a conversa: ativos, que ainda não são responsáveis e, quando a conversa não é
 * visível para a equipe, apenas o proprietário (o banco é a autoridade; isto só evita opções inúteis).
 */
export function assignableMembers(
  members: DirectoryMember[],
  assignees: ConversationAssignee[],
  conversationVisibility: string,
): DirectoryMember[] {
  const taken = new Set(assignees.map((assignee) => assignee.member_id));
  return members.filter(
    (member) => !taken.has(member.member_id) && (conversationVisibility === "commercial" || member.role === "owner"),
  );
}

/** "Ana", "Ana e Bruno", "Ana, Bruno e Carla": texto curto para a lista de conversas. */
export function formatAssigneeNames(assignees: ConversationAssignee[] | undefined | null): string | null {
  const names = (assignees ?? []).map((assignee) => assignee.display_name?.trim()).filter((name): name is string => Boolean(name));
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}
