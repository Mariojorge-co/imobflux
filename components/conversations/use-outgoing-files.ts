"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { discardOutgoingUploadAction, prepareOutgoingUploadAction } from "@/lib/conversations/media-send";
import {
  canPreviewImage,
  extensionOf,
  HEAD_BYTES,
  MAX_FILES_PER_BATCH,
  validateOutgoingFile,
  type MediaKind,
} from "@/lib/conversations/outgoing-files";
import { UploadError, uploadToSignedUrl, type UploadHandle } from "@/lib/conversations/upload-client";

export type OutgoingItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: MediaKind;
  mime: string;
  /** Miniatura local (só imagens que o navegador exibe). */
  previewUrl: string | null;
  caption: string;
  asDocument: boolean;
  status: "uploading" | "ready" | "error";
  /** 0 a 1. */
  progress: number;
  error: string | null;
  /** Caminho no Storage depois do upload. */
  path: string | null;
};

/**
 * Arquivos escolhidos para enviar numa conversa: valida (tipo/tamanho/conteúdo), envia direto ao Storage com progresso
 * e permite cancelar/remover. O envio ao cliente é uma etapa separada (botão Enviar).
 */
export function useOutgoingFiles(conversationId: string) {
  const [items, setItems] = useState<OutgoingItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef<OutgoingItem[]>([]);
  const uploads = useRef(new Map<string, UploadHandle>());
  const kept = useRef(new Set<string>()); // miniaturas que passaram para a bolha "enviando…" (não revogar aqui)

  const commit = useCallback((updater: (previous: OutgoingItem[]) => OutgoingItem[]) => {
    setItems((previous) => {
      const next = updater(previous);
      itemsRef.current = next;
      return next;
    });
  }, []);

  const patch = useCallback(
    (id: string, changes: Partial<OutgoingItem>) => commit((previous) => previous.map((item) => (item.id === id ? { ...item, ...changes } : item))),
    [commit],
  );

  const startUpload = useCallback(
    async (item: OutgoingItem) => {
      const prepared = await prepareOutgoingUploadAction({ conversationId, fileName: item.name, size: item.size });
      if (!prepared.success) {
        patch(item.id, { status: "error", error: prepared.error });
        return;
      }
      const handle = uploadToSignedUrl(prepared.signedUrl, item.file, (fraction) => patch(item.id, { progress: fraction }));
      uploads.current.set(item.id, handle);
      try {
        await handle.promise;
        patch(item.id, { status: "ready", progress: 1, path: prepared.path });
      } catch (error) {
        if (error instanceof UploadError && error.code === "ABORTED") return; // removido pela pessoa
        patch(item.id, { status: "error", error: error instanceof UploadError ? error.message : "Falha ao enviar o arquivo." });
      } finally {
        uploads.current.delete(item.id);
      }
    },
    [conversationId, patch],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const rejected: string[] = [];
      const room = Math.max(0, MAX_FILES_PER_BATCH - itemsRef.current.length);
      const candidates = files.slice(0, room);
      if (files.length > room) rejected.push(`Máximo de ${MAX_FILES_PER_BATCH} arquivos por vez: ${files.length - room} não ${files.length - room === 1 ? "foi adicionado" : "foram adicionados"}.`);

      const accepted: OutgoingItem[] = [];
      for (const file of candidates) {
        const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
        const verdict = validateOutgoingFile({ fileName: file.name, size: file.size, head });
        if (!verdict.ok) {
          rejected.push(`${file.name || "Arquivo"}: ${verdict.message}`);
          continue;
        }
        accepted.push({
          id: crypto.randomUUID(),
          file,
          name: verdict.fileName,
          size: file.size,
          kind: verdict.kind,
          mime: verdict.mime,
          previewUrl: verdict.kind === "image" && canPreviewImage(extensionOf(verdict.fileName)) ? URL.createObjectURL(file) : null,
          caption: "",
          asDocument: false,
          status: "uploading",
          progress: 0,
          error: null,
          path: null,
        });
      }
      setNotice(rejected.length > 0 ? rejected.join(" ") : null);
      if (accepted.length === 0) return;
      commit((previous) => [...previous, ...accepted]);
      for (const item of accepted) void startUpload(item);
    },
    [commit, startUpload],
  );

  const remove = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item) return;
      uploads.current.get(id)?.abort();
      if (item.previewUrl && !kept.current.has(id)) URL.revokeObjectURL(item.previewUrl);
      if (item.path) void discardOutgoingUploadAction({ conversationId, path: item.path });
      commit((previous) => previous.filter((candidate) => candidate.id !== id));
    },
    [commit, conversationId],
  );

  const setCaption = useCallback((id: string, caption: string) => patch(id, { caption }), [patch]);
  const setAsDocument = useCallback((id: string, asDocument: boolean) => patch(id, { asDocument }), [patch]);

  /** Tira da bandeja os arquivos prontos (na ordem) para serem enviados; a miniatura passa para a bolha provisória. */
  const takeReady = useCallback((): OutgoingItem[] => {
    const ready = itemsRef.current.filter((item) => item.status === "ready" && item.path);
    for (const item of ready) kept.current.add(item.id);
    commit((previous) => previous.filter((item) => !ready.some((candidate) => candidate.id === item.id)));
    return ready;
  }, [commit]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const uploading = items.some((item) => item.status === "uploading");
  const readyCount = items.filter((item) => item.status === "ready").length;

  // Ao sair da conversa: cancela uploads em andamento e solta as miniaturas que ainda estão na bandeja.
  useEffect(() => {
    const running = uploads.current;
    const keptIds = kept.current;
    return () => {
      for (const handle of running.values()) handle.abort();
      for (const item of itemsRef.current) if (item.previewUrl && !keptIds.has(item.id)) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  return { items, notice, clearNotice, uploading, readyCount, addFiles, remove, setCaption, setAsDocument, takeReady };
}

export type OutgoingFiles = ReturnType<typeof useOutgoingFiles>;
