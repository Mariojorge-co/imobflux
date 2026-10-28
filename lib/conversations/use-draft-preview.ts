"use client";

import { useEffect, useState } from "react";
import { getDraftPreview, subscribeDrafts } from "@/lib/conversations/drafts";

const DEBOUNCE_MS = 300;

/**
 * "Rascunho:" do cartão da conversa. Lê só depois de montar (o servidor não conhece o rascunho: sem diferença na hidratação),
 * espera um instante enquanto a pessoa digita e some na hora quando o rascunho acaba (enviou ou apagou).
 */
export function useDraftPreview(conversationId: string, enabled = true): string {
  const [preview, setPreview] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => setPreview(getDraftPreview(conversationId));
    const frame = window.requestAnimationFrame(read);
    const unsubscribe = subscribeDrafts(() => {
      if (timer) clearTimeout(timer);
      if (getDraftPreview(conversationId) === "") return read();
      timer = setTimeout(read, DEBOUNCE_MS);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [conversationId, enabled]);

  return enabled ? preview : "";
}
