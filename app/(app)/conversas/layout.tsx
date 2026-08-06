import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui";

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
    <div className="flex min-h-[calc(100vh-var(--spacing-topbar))] flex-col">
      {/* Cabeçalho visível apenas em mobile (no desktop cada sub-rota pode ter o seu) */}
      <div className="border-b border-border px-page py-3 md:hidden">
        <PageHeader title="Conversas" />
      </div>

      {/*
       * Grid principal:
       * - Mobile: 1 coluna — apenas children ocupa o espaço (a lista é
       *   renderizada em /conversas/page.tsx e ocupa a tela inteira nessa rota)
       * - Desktop: 2 colunas fixas: lista (320px) + detalhe (restante)
       */}
      <div className="flex min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}
