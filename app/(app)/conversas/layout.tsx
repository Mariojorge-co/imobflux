import type { ReactNode } from "react";

type ConversasLayoutProps = {
  children: ReactNode;
};

/**
 * Layout das rotas /conversas e /conversas/[conversationId].
 *
 * Estrutura responsiva sem Parallel Routes:
 * - Desktop (md+): coluna esquerda (lista) + coluna direita (children = detalhe).
 * - Mobile (<md): a coluna esquerda ocupa toda a largura na rota /conversas;
 *   a rota /conversas/[conversationId] renderiza apenas o detalhe (a lista fica
 *   oculta via CSS na rota filha). O botão "Voltar" no detalhe é responsabilidade
 *   de cada page.tsx filha.
 *
 * A lista não é duplicada: ela é renderizada aqui (layout) de forma persistente
 * no desktop. No mobile o slot da lista fica visível somente quando não há
 * conversationId na URL — isso é controlado pelo CSS de visibilidade condicional
 * aplicado ao slot de lista vs. ao children.
 */
export default function ConversasLayout({ children }: ConversasLayoutProps) {
  return (
    <div className="flex h-[calc(100dvh-64px)] w-full flex-col overflow-hidden">
      <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
