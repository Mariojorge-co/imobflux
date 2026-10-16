import "server-only";

import { getOptionalActiveAccess } from "@/lib/auth/dal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { QuickReply, QuickReplyAttachment, QuickReplyCategory, QuickReplyLibrary } from "@/lib/quick-replies/types";

/** Respostas e categorias do workspace de quem está logado (RLS) + dados das variáveis. Nulo sem sessão ativa. */
export async function getQuickReplyLibrary(): Promise<QuickReplyLibrary | null> {
  const access = await getOptionalActiveAccess();
  if (!access) return null;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_quick_replies");
  if (error) throw error;

  const payload = data as unknown as {
    me: { member_id: string; role: "owner" | "attendant" };
    categories: QuickReplyCategory[];
    replies: QuickReply[];
  };

  // Anexos: leitura separada e tolerante (se o banco ainda não tem a função, as respostas aparecem só com texto).
  const attachmentsByReply = new Map<string, QuickReplyAttachment[]>();
  const { data: attachmentData } = await supabase.rpc("get_quick_reply_attachments");
  for (const attachment of Array.isArray(attachmentData) ? (attachmentData as unknown as QuickReplyAttachment[]) : []) {
    const list = attachmentsByReply.get(attachment.quick_reply_id) ?? [];
    list.push(attachment);
    attachmentsByReply.set(attachment.quick_reply_id, list);
  }

  const admin = createAdminSupabaseClient();
  const { data: workspace } = await admin.from("workspaces").select("name").eq("id", access.workspaceId).maybeSingle();

  return {
    me: payload.me,
    categories: payload.categories ?? [],
    replies: (payload.replies ?? []).map((reply) => ({ ...reply, attachments: attachmentsByReply.get(reply.id) ?? [] })),
    workspaceName: workspace?.name ?? "",
    memberName: access.displayName,
  };
}
