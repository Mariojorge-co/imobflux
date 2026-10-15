"use client";

import { useCallback, useRef, useState } from "react";
import { loadQuickRepliesAction, recordQuickReplyUseAction } from "@/lib/quick-replies/actions";
import type { QuickReplyLibrary } from "@/lib/quick-replies/types";

export type QuickReplyLoadState = "idle" | "loading" | "ready" | "error";

/**
 * Biblioteca de respostas rápidas no navegador: carrega sob demanda (a primeira vez que a pessoa abre o painel ou
 * digita "/"), recarrega depois de criar/editar/apagar e conta o uso sem bloquear a inserção.
 */
export function useQuickReplies(initial?: QuickReplyLibrary | null) {
  const [library, setLibrary] = useState<QuickReplyLibrary | null>(initial ?? null);
  const [state, setState] = useState<QuickReplyLoadState>(initial ? "ready" : "idle");
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const reload = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState((current) => (current === "ready" ? current : "loading"));
    try {
      const result = await loadQuickRepliesAction();
      if (result.success) {
        setLibrary(result.library);
        setState("ready");
        setError(null);
      } else {
        setState("error");
        setError(result.error);
      }
    } catch {
      setState("error");
      setError("Não foi possível carregar as respostas rápidas. Verifique a conexão e tente novamente.");
    } finally {
      loadingRef.current = false;
    }
  }, []);

  /** Carrega só se ainda não carregou (ou se a última tentativa falhou). */
  const ensureLoaded = useCallback(() => {
    if (state === "idle" || state === "error") void reload();
  }, [reload, state]);

  /** Conta um uso em segundo plano: a inserção já aconteceu e uma falha aqui não a desfaz. */
  const recordUse = useCallback((replyId: string) => {
    setLibrary((current) =>
      current
        ? {
            ...current,
            replies: current.replies.map((reply) =>
              reply.id === replyId
                ? { ...reply, use_count: reply.use_count + 1, last_used_at: new Date().toISOString() }
                : reply,
            ),
          }
        : current,
    );
    void recordQuickReplyUseAction(replyId).catch(() => undefined);
  }, []);

  return { library, state, error, reload, ensureLoaded, recordUse };
}
