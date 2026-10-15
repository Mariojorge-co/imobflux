import type { QuickReplyViewer } from "@/lib/quick-replies/types";

/** OWNER edita/apaga qualquer item; ATTENDANT só o que ele mesmo criou (mesma regra do banco). */
export function canManageItem(viewer: QuickReplyViewer, createdByMemberId: string): boolean {
  return viewer.role === "owner" || viewer.member_id === createdByMemberId;
}

const ERROR_MESSAGES: Record<string, string> = {
  quick_reply_not_authorized: "Você não tem permissão para fazer isso. Cada pessoa edita só o que criou; o proprietário edita tudo.",
  quick_reply_not_found: "Este item não existe mais. Atualize a lista.",
  quick_reply_category_not_found: "A categoria escolhida não existe mais. Atualize a lista.",
  quick_reply_category_duplicate: "Já existe uma categoria com esse nome.",
  quick_reply_category_name_invalid: "O nome da categoria deve ter de 1 a 40 caracteres.",
  quick_reply_title_invalid: "O título deve ter de 1 a 60 caracteres.",
  quick_reply_body_invalid: "O texto não pode ficar vazio nem passar de 4000 caracteres.",
  quick_reply_examples_not_empty: "Os exemplos só podem ser adicionados quando ainda não há respostas.",
};

/** Mensagem em português para o erro devolvido pelo banco (que usa códigos como mensagem). */
export function quickReplyErrorMessage(error: unknown, fallback = "Não foi possível concluir. Tente novamente."): string {
  const message =
    typeof error === "string" ? error : error instanceof Error ? error.message : (error as { message?: string } | null)?.message;
  if (!message) return fallback;
  for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(code)) return text;
  }
  return fallback;
}
