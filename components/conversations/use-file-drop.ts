"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

const hasFiles = (event: { dataTransfer?: DataTransfer | null }) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * Arrastar e soltar arquivos sobre a conversa: devolve o estado "arrastando" (para destacar a área) e os handlers da
 * área de soltar. Enquanto a conversa está aberta, soltar um arquivo FORA da área também não faz o navegador abri-lo
 * em outra aba (o padrão do navegador é navegar até o arquivo).
 */
export function useFileDrop(options: { enabled: boolean; onFiles: (files: File[]) => void }) {
  const { enabled, onFiles } = options;
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const prevent = (event: globalThis.DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const onDragEnter = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [enabled],
  );
  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!enabled || !hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [enabled],
  );
  const onDragLeave = useCallback((event: DragEvent) => {
    if (!hasFiles(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  }, []);
  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!enabled) return;
      onFiles(Array.from(event.dataTransfer.files));
    },
    [enabled, onFiles],
  );

  return { dragging: enabled && dragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
