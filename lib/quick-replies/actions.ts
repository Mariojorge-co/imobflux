"use server";

import { revalidatePath } from "next/cache";
import { getQuickReplyLibrary } from "@/lib/quick-replies/data";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { quickReplyErrorMessage } from "@/lib/quick-replies/permissions";
import {
  QUICK_REPLY_BODY_MAX,
  QUICK_REPLY_CATEGORY_MAX,
  QUICK_REPLY_TITLE_MAX,
  type QuickReplyActionResult,
  type QuickReplyLibrary,
} from "@/lib/quick-replies/types";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETTINGS_PATH = "/configuracoes/respostas-rapidas";

/** Registra só o código do erro: a mensagem completa do banco pode trazer o texto da resposta. */
function logFailure(scope: string, error: unknown) {
  const code = (error as { code?: string } | null)?.code ?? "desconhecido";
  console.error(`Erro em ${scope} (código ${code})`);
}

function failure(scope: string, error: unknown): { success: false; error: string } {
  logFailure(scope, error);
  return { success: false, error: quickReplyErrorMessage(error) };
}

/** Respostas, categorias e os dados para as variáveis ({{empresa}} e {{meu_nome}}). */
export async function loadQuickRepliesAction(): Promise<QuickReplyActionResult<{ library: QuickReplyLibrary }>> {
  try {
    const library = await getQuickReplyLibrary();
    if (!library) return { success: false, error: "Sessão expirada. Faça login novamente." };
    return { success: true, library };
  } catch (error) {
    return failure("loadQuickRepliesAction", error);
  }
}

export type SaveQuickReplyInput = {
  id?: string | null;
  title: string;
  body: string;
  categoryId: string | null;
  isActive: boolean;
};

export async function saveQuickReplyAction(input: SaveQuickReplyInput): Promise<QuickReplyActionResult<{ id: string }>> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > QUICK_REPLY_TITLE_MAX) {
    return { success: false, error: quickReplyErrorMessage("quick_reply_title_invalid") };
  }
  if (input.body.trim() === "" || input.body.length > QUICK_REPLY_BODY_MAX) {
    return { success: false, error: quickReplyErrorMessage("quick_reply_body_invalid") };
  }
  if ((input.id && !UUID_REGEX.test(input.id)) || (input.categoryId && !UUID_REGEX.test(input.categoryId))) {
    return { success: false, error: quickReplyErrorMessage("quick_reply_not_found") };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("save_quick_reply", {
      p_reply_id: input.id ?? null,
      p_title: title,
      // O texto vai exatamente como foi digitado (quebras de linha, emojis, *negrito*, _itálico_).
      p_body: input.body,
      p_category_id: input.categoryId,
      p_is_active: input.isActive,
    });
    if (error) return failure("saveQuickReplyAction", error);
    revalidatePath(SETTINGS_PATH);
    return { success: true, id: (data as { id: string }).id };
  } catch (error) {
    return failure("saveQuickReplyAction", error);
  }
}

export async function deleteQuickReplyAction(replyId: string): Promise<QuickReplyActionResult> {
  if (!UUID_REGEX.test(replyId)) return { success: false, error: quickReplyErrorMessage("quick_reply_not_found") };
  try {
    const supabase = await createServerSupabaseClient();
    // Sem cascata no banco: primeiro cada anexo é removido (o banco confere a permissão e devolve o caminho do arquivo), depois a
    // resposta. Os arquivos do Storage são apagados no fim.
    const { data: attachments } = await supabase.from("quick_reply_attachments").select("id").eq("quick_reply_id", replyId);
    const paths: string[] = [];
    for (const attachment of attachments ?? []) {
      const { data: removed, error: removeError } = await supabase.rpc("remove_quick_reply_attachment", { p_attachment_id: attachment.id });
      if (removeError) return failure("deleteQuickReplyAction", removeError);
      const path = (removed as { storage_path?: string } | null)?.storage_path;
      if (path) paths.push(path);
    }
    const { error } = await supabase.rpc("delete_quick_reply", { p_reply_id: replyId });
    if (error) return failure("deleteQuickReplyAction", error);
    if (paths.length > 0) await createAdminSupabaseClient().storage.from("whatsapp-media").remove(paths).catch(() => undefined);
    revalidatePath(SETTINGS_PATH);
    return { success: true };
  } catch (error) {
    return failure("deleteQuickReplyAction", error);
  }
}

export async function saveQuickReplyCategoryAction(
  categoryId: string | null,
  name: string,
): Promise<QuickReplyActionResult<{ id: string; name: string }>> {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > QUICK_REPLY_CATEGORY_MAX) {
    return { success: false, error: quickReplyErrorMessage("quick_reply_category_name_invalid") };
  }
  if (categoryId && !UUID_REGEX.test(categoryId)) {
    return { success: false, error: quickReplyErrorMessage("quick_reply_not_found") };
  }
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("save_quick_reply_category", {
      p_category_id: categoryId,
      p_name: trimmed,
    });
    if (error) return failure("saveQuickReplyCategoryAction", error);
    revalidatePath(SETTINGS_PATH);
    const result = data as { id: string; name: string };
    return { success: true, id: result.id, name: result.name };
  } catch (error) {
    return failure("saveQuickReplyCategoryAction", error);
  }
}

export async function deleteQuickReplyCategoryAction(
  categoryId: string,
): Promise<QuickReplyActionResult<{ repliesMoved: number }>> {
  if (!UUID_REGEX.test(categoryId)) return { success: false, error: quickReplyErrorMessage("quick_reply_not_found") };
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("delete_quick_reply_category", { p_category_id: categoryId });
    if (error) return failure("deleteQuickReplyCategoryAction", error);
    revalidatePath(SETTINGS_PATH);
    return { success: true, repliesMoved: Number((data as { replies_moved?: number })?.replies_moved ?? 0) };
  } catch (error) {
    return failure("deleteQuickReplyCategoryAction", error);
  }
}

/** Conta um uso. É chamada sem bloquear a inserção; qualquer falha é silenciosa para quem usa. */
export async function recordQuickReplyUseAction(replyId: string): Promise<{ success: boolean }> {
  if (!UUID_REGEX.test(replyId)) return { success: false };
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc("record_quick_reply_use", { p_reply_id: replyId });
    if (error) {
      logFailure("recordQuickReplyUseAction", error);
      return { success: false };
    }
    return { success: true };
  } catch (error) {
    logFailure("recordQuickReplyUseAction", error);
    return { success: false };
  }
}

/** Ação do usuário: cria os 5 modelos de exemplo na lista vazia. */
export async function addExampleQuickRepliesAction(): Promise<QuickReplyActionResult<{ count: number }>> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("add_example_quick_replies");
    if (error) return failure("addExampleQuickRepliesAction", error);
    revalidatePath(SETTINGS_PATH);
    return { success: true, count: Number((data as { count?: number })?.count ?? 0) };
  } catch (error) {
    return failure("addExampleQuickRepliesAction", error);
  }
}
