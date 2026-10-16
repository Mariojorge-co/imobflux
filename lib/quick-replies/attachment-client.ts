"use client";

import {
  confirmQuickReplyAttachmentAction,
  getQuickReplyFileSourcesAction,
  prepareQuickReplyAttachmentUploadAction,
} from "@/lib/quick-replies/attachment-actions";
import { uploadToSignedUrl } from "@/lib/conversations/upload-client";
import { HEAD_BYTES, validateOutgoingFile } from "@/lib/conversations/outgoing-files";

/** Confere o arquivo no navegador (nome, tipo, tamanho, conteúdo). Devolve o motivo da recusa ou nulo se está ok. */
export async function checkQuickReplyFile(file: File): Promise<string | null> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const verdict = validateOutgoingFile({ fileName: file.name, size: file.size, head });
  return verdict.ok ? null : `${file.name || "Arquivo"}: ${verdict.message}`;
}

/** Envia um arquivo para a resposta (autoriza, sobe direto ao Storage e registra). */
export async function uploadQuickReplyAttachment(
  replyId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ success: true } | { success: false; error: string }> {
  const prepared = await prepareQuickReplyAttachmentUploadAction({ replyId, fileName: file.name, size: file.size });
  if (!prepared.success) return prepared;
  try {
    await uploadToSignedUrl(prepared.signedUrl, file, onProgress ?? (() => undefined)).promise;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Falha ao enviar o arquivo." };
  }
  const confirmed = await confirmQuickReplyAttachmentAction({ replyId, path: prepared.path, fileName: file.name });
  return confirmed.success ? { success: true } : confirmed;
}

/**
 * Baixa os arquivos de uma resposta e os devolve como `File`, para entrarem na bandeja de envio da conversa (que valida,
 * copia para o caminho de envio da conversa e só envia quando a pessoa mandar).
 */
export async function loadQuickReplyFiles(replyId: string): Promise<{ files: File[]; error: string | null }> {
  const result = await getQuickReplyFileSourcesAction(replyId);
  if (!result.success) return { files: [], error: result.error };
  const files: File[] = [];
  let failed = 0;
  for (const source of result.files) {
    try {
      const response = await fetch(source.url);
      if (!response.ok) throw new Error("download");
      const blob = await response.blob();
      files.push(new File([blob], source.fileName, { type: source.mimeType }));
    } catch {
      failed += 1;
    }
  }
  return {
    files,
    error: failed > 0 ? `${failed} ${failed === 1 ? "arquivo da resposta não pôde" : "arquivos da resposta não puderam"} ser carregado${failed === 1 ? "" : "s"}.` : null,
  };
}
