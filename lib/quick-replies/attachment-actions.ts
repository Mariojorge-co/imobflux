"use server";

import { revalidatePath } from "next/cache";
import { getOptionalActiveAccess } from "@/lib/auth/dal";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { HEAD_BYTES, validateOutgoingFile } from "@/lib/conversations/outgoing-files";
import { quickReplyErrorMessage } from "@/lib/quick-replies/permissions";
import { QUICK_REPLY_ATTACHMENT_MAX, type QuickReplyActionResult } from "@/lib/quick-replies/types";

// Anexos das respostas rápidas. O navegador envia o arquivo DIRETO ao bucket privado (URL assinada de vida curta); aqui só
// se autoriza o upload, se confere o que foi guardado (tipo pelo conteúdo, tamanho, mesmas regras do envio normal) e se
// registra o anexo. Para usar, o navegador recebe URLs assinadas de poucos minutos e copia o arquivo para a conversa pelo
// caminho normal de envio. Nada que identifique o arquivo ou a URL vai para log.

const BUCKET = "whatsapp-media";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SETTINGS_PATH = "/configuracoes/respostas-rapidas";
const USE_URL_SECONDS = 300;

const ATTACHMENT_ERRORS: Record<string, string> = {
  quick_reply_attachment_limit: `Cada resposta aceita até ${QUICK_REPLY_ATTACHMENT_MAX} arquivos.`,
  quick_reply_attachment_invalid: "Os dados do arquivo são inválidos.",
};

function logFailure(scope: string, error: unknown) {
  const code = (error as { code?: string } | null)?.code ?? "desconhecido";
  console.error(`Erro em ${scope} (código ${code})`);
}

function failure(scope: string, error: unknown): { success: false; error: string } {
  logFailure(scope, error);
  const message = (error as { message?: string } | null)?.message ?? "";
  for (const [code, text] of Object.entries(ATTACHMENT_ERRORS)) {
    if (message.includes(code)) return { success: false, error: text };
  }
  return { success: false, error: quickReplyErrorMessage(error, "Não foi possível concluir o anexo. Tente novamente.") };
}

/** A pessoa pode mexer nos anexos desta resposta? Mesma regra do banco: dono em qualquer uma; atendente só na que criou. */
async function authorizeReply(replyId: string): Promise<{ workspaceId: string } | { error: string }> {
  if (!UUID_REGEX.test(replyId)) return { error: quickReplyErrorMessage("quick_reply_not_found") };
  const access = await getOptionalActiveAccess();
  if (!access) return { error: "Sessão expirada. Faça login novamente." };
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("quick_replies").select("created_by_member_id").eq("id", replyId).maybeSingle();
  if (!data) return { error: quickReplyErrorMessage("quick_reply_not_found") };
  if (access.role !== "owner" && data.created_by_member_id !== access.memberId) {
    return { error: quickReplyErrorMessage("quick_reply_not_authorized") };
  }
  return { workspaceId: access.workspaceId };
}

/** 1º passo: autoriza UM upload (confere permissão, nome, tipo e tamanho) e devolve a URL assinada. */
export async function prepareQuickReplyAttachmentUploadAction(input: {
  replyId: string;
  fileName: string;
  size: number;
}): Promise<QuickReplyActionResult<{ path: string; signedUrl: string }>> {
  try {
    const access = await authorizeReply(String(input.replyId ?? ""));
    if ("error" in access) return { success: false, error: access.error };
    const quick = validateOutgoingFile({ fileName: String(input.fileName ?? ""), size: Number(input.size) });
    if (!quick.ok) return { success: false, error: quick.message };

    const supabase = await createServerSupabaseClient();
    const { count } = await supabase
      .from("quick_reply_attachments")
      .select("id", { count: "exact", head: true })
      .eq("quick_reply_id", input.replyId);
    if ((count ?? 0) >= QUICK_REPLY_ATTACHMENT_MAX) return { success: false, error: ATTACHMENT_ERRORS.quick_reply_attachment_limit };

    const path = `${access.workspaceId}/quick-replies/${input.replyId}/${crypto.randomUUID()}`;
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return failure("prepareQuickReplyAttachmentUploadAction", error);
    return { success: true, path, signedUrl: data.signedUrl };
  } catch (error) {
    return failure("prepareQuickReplyAttachmentUploadAction", error);
  }
}

/** Lê o tamanho e os primeiros bytes do arquivo guardado (por URL assinada, sem baixar tudo). */
async function inspectStoredObject(path: string): Promise<{ size: number; head: Uint8Array } | null> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return null;
  try {
    const response = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
    if (!response.ok && response.status !== 206) return null;
    const buffer = new Uint8Array(await response.arrayBuffer());
    const range = response.headers.get("content-range");
    const total = range ? Number(range.split("/")[1]) : Number(response.headers.get("content-length"));
    const size = Number.isFinite(total) && total > 0 ? total : buffer.length;
    return { size, head: buffer.slice(0, HEAD_BYTES) };
  } catch {
    return null;
  }
}

/** 2º passo: o arquivo já está no Storage. Confere o conteúdo guardado e registra o anexo; se algo falhar, apaga o arquivo. */
export async function confirmQuickReplyAttachmentAction(input: {
  replyId: string;
  path: string;
  fileName: string;
}): Promise<QuickReplyActionResult<{ id: string }>> {
  const admin = createAdminSupabaseClient();
  const discard = async (path: string) => {
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
  };
  try {
    const access = await authorizeReply(String(input.replyId ?? ""));
    if ("error" in access) return { success: false, error: access.error };
    const prefix = `${access.workspaceId}/quick-replies/${input.replyId}/`;
    const path = String(input.path ?? "");
    // O caminho só vale se foi gerado para esta resposta (o banco confere de novo).
    if (!path.startsWith(prefix) || path.length > prefix.length + 64 || path.includes("..")) {
      return { success: false, error: "Os dados do arquivo são inválidos." };
    }

    const inspected = await inspectStoredObject(path);
    if (!inspected) return { success: false, error: "O arquivo não chegou ao servidor. Anexe de novo." };
    const verdict = validateOutgoingFile({ fileName: String(input.fileName ?? ""), size: inspected.size, head: inspected.head });
    if (!verdict.ok) {
      await discard(path);
      return { success: false, error: verdict.message };
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("add_quick_reply_attachment", {
      p_reply_id: input.replyId,
      p_storage_path: path,
      p_file_name: verdict.fileName,
      p_mime_type: verdict.mime,
      p_size_bytes: inspected.size,
      p_media_kind: verdict.kind,
    });
    if (error) {
      await discard(path);
      return failure("confirmQuickReplyAttachmentAction", error);
    }
    revalidatePath(SETTINGS_PATH);
    return { success: true, id: (data as { id: string }).id };
  } catch (error) {
    return failure("confirmQuickReplyAttachmentAction", error);
  }
}

/** Remove um anexo: primeiro o registro (o banco confere a permissão), depois o arquivo do Storage. */
export async function removeQuickReplyAttachmentAction(attachmentId: string): Promise<QuickReplyActionResult> {
  if (!UUID_REGEX.test(attachmentId)) return { success: false, error: quickReplyErrorMessage("quick_reply_not_found") };
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("remove_quick_reply_attachment", { p_attachment_id: attachmentId });
    if (error) return failure("removeQuickReplyAttachmentAction", error);
    const path = (data as { storage_path?: string } | null)?.storage_path;
    if (path) await createAdminSupabaseClient().storage.from(BUCKET).remove([path]).catch(() => undefined);
    revalidatePath(SETTINGS_PATH);
    return { success: true };
  } catch (error) {
    return failure("removeQuickReplyAttachmentAction", error);
  }
}

export type QuickReplyFileSource = { id: string; fileName: string; mimeType: string; size: number; url: string };

/**
 * Ao usar a resposta: devolve URLs assinadas (poucos minutos) dos arquivos dela. A RLS decide se a pessoa enxerga a resposta;
 * o navegador baixa os arquivos e os envia pelo caminho normal de envio de arquivos (mesmas validações, fila e limites).
 */
export async function getQuickReplyFileSourcesAction(replyId: string): Promise<QuickReplyActionResult<{ files: QuickReplyFileSource[] }>> {
  if (!UUID_REGEX.test(replyId)) return { success: false, error: quickReplyErrorMessage("quick_reply_not_found") };
  try {
    const access = await getOptionalActiveAccess();
    if (!access) return { success: false, error: "Sessão expirada. Faça login novamente." };
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("quick_reply_attachments")
      .select("id, file_name, mime_type, size_bytes, storage_path")
      .eq("quick_reply_id", replyId)
      .order("position", { ascending: true });
    if (error) return failure("getQuickReplyFileSourcesAction", error);

    const admin = createAdminSupabaseClient();
    const files: QuickReplyFileSource[] = [];
    for (const row of data ?? []) {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(row.storage_path, USE_URL_SECONDS);
      if (signed?.signedUrl) {
        files.push({ id: row.id, fileName: row.file_name, mimeType: row.mime_type, size: Number(row.size_bytes), url: signed.signedUrl });
      }
    }
    return { success: true, files };
  } catch (error) {
    return failure("getQuickReplyFileSourcesAction", error);
  }
}
