export const QUICK_REPLY_TITLE_MAX = 60;
export const QUICK_REPLY_BODY_MAX = 4000;
export const QUICK_REPLY_CATEGORY_MAX = 40;

export type QuickReplyCategory = {
  id: string;
  name: string;
  created_by_member_id: string;
};

export type QuickReply = {
  id: string;
  title: string;
  body: string;
  category_id: string | null;
  is_active: boolean;
  use_count: number;
  last_used_at: string | null;
  created_by_member_id: string;
};

export type QuickReplyViewer = { member_id: string; role: "owner" | "attendant" };

/** Tudo o que a tela precisa para listar e inserir respostas rápidas. */
export type QuickReplyLibrary = {
  me: QuickReplyViewer;
  categories: QuickReplyCategory[];
  replies: QuickReply[];
  /** Nome do workspace ({{empresa}}) e de quem atende ({{meu_nome}}). */
  workspaceName: string;
  memberName: string;
};

export type QuickReplyActionResult<T extends object = object> =
  | ({ success: true } & T)
  | { success: false; error: string };
