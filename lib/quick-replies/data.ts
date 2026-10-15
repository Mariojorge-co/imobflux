import "server-only";

import { getOptionalActiveAccess } from "@/lib/auth/dal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { QuickReply, QuickReplyCategory, QuickReplyLibrary } from "@/lib/quick-replies/types";

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

  const admin = createAdminSupabaseClient();
  const { data: workspace } = await admin.from("workspaces").select("name").eq("id", access.workspaceId).maybeSingle();

  return {
    me: payload.me,
    categories: payload.categories ?? [],
    replies: payload.replies ?? [],
    workspaceName: workspace?.name ?? "",
    memberName: access.displayName,
  };
}
