"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

type ConversationsShellProps = {
  /** Lista de conversas (persistente: fica montada ao trocar de conversa). */
  list: ReactNode;
  /** Painel da conversa selecionada (ou o estado "selecione uma conversa"). */
  children: ReactNode;
};

/**
 * Estrutura das rotas /conversas e /conversas/[id].
 * - Desktop (md+): lista à esquerda, painel à direita.
 * - Celular: só a lista em /conversas; só o painel em /conversas/[id].
 * A lista vive no layout, então trocar de conversa só renderiza o painel (a lista não é recarregada).
 */
export function ConversationsShell({ list, children }: ConversationsShellProps) {
  const selected = useSelectedLayoutSegment();

  return (
    <div className="flex h-full w-full">
      <div className={`${selected ? "hidden md:block" : "block"} w-full shrink-0 md:w-[19rem] xl:w-80`}>{list}</div>
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
