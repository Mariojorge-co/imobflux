"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  archiveOpportunityAction,
  reorderOpportunityAction,
  openOrCreateOpportunityConversationAction,
} from "@/lib/kanban/actions";
import type { ContactSelectItem, MemberSelectItem } from "@/lib/kanban/data";
import { Button } from "@/components/ui";
import type { ContactClassification, KanbanCard, KanbanStage } from "@/types/kanban";
import { reorderCards } from "@/lib/kanban/reorder";

import { CreateOpportunityDialog } from "./create-opportunity-dialog";
import { KanbanColumn } from "./kanban-column";
import { OpportunityDetailDrawer } from "./opportunity-detail-drawer";

interface KanbanBoardProps {
  initialStages: KanbanStage[];
  contacts: ContactSelectItem[];
  members: MemberSelectItem[];
  userRole?: string;
}

export function KanbanBoard({
  initialStages,
  contacts,
  members,
  userRole = "owner",
}: KanbanBoardProps) {
  const router = useRouter();
  const [stages, setStages] = useState<KanbanStage[]>(initialStages);
  const [prevInitialStages, setPrevInitialStages] = useState(initialStages);
  const [pendingCardIds, setPendingCardIds] = useState<Set<string>>(new Set());
  const snapshotRef = useRef<KanbanStage[]>(initialStages);
  const [, startTransition] = useTransition();

  const boardContainerRef = useRef<HTMLDivElement>(null);
  const [isGrabbing, setIsGrabbing] = useState(false);
  const isDraggingBgRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

  const [notification, setNotification] = useState<{
    type: "info" | "error" | "warning" | "success";
    message: string;
  } | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<KanbanCard | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  if (initialStages !== prevInitialStages) {
    setPrevInitialStages(initialStages);
    if (pendingCardIds.size === 0) {
      setStages(initialStages);
    }
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (
      target.closest("[draggable='true']") ||
      target.closest("button") ||
      target.closest("select") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest("a") ||
      target.closest("[role='dialog']") ||
      target.closest("[role='menu']")
    ) {
      return;
    }

    if (!boardContainerRef.current) return;

    isDraggingBgRef.current = true;
    startXRef.current = e.pageX - boardContainerRef.current.offsetLeft;
    scrollLeftRef.current = boardContainerRef.current.scrollLeft;
    setIsGrabbing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingBgRef.current || !boardContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - boardContainerRef.current.offsetLeft;
    const walk = (x - startXRef.current) * 1.2;
    boardContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
  };

  const handleMouseUpOrLeave = () => {
    if (isDraggingBgRef.current) {
      isDraggingBgRef.current = false;
      setIsGrabbing(false);
    }
  };

  useEffect(() => {
    const container = boardContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      if (e.deltaY !== 0 && !e.shiftKey) {
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const stageOptions = stages.map((s) => ({ id: s.id, name: s.name }));
  const contactOptions = contacts.map((c) => ({
    id: c.id,
    name: c.displayName,
    classification: c.classification as ContactClassification,
  }));
  const memberOptions = members.map((m) => ({ id: m.id, name: m.displayName }));

  const totalCards = stages.reduce((acc, s) => acc + s.cards.length, 0);

  const handleCardClick = (card: KanbanCard) => {
    setSelectedCard(card);
    setIsDrawerOpen(true);
  };

  const handleCreatedOpportunity = (newCard: KanbanCard, stageId: string) => {
    setStages((prevStages) =>
      prevStages.map((st) => {
        if (st.id === stageId) {
          if (st.cards.some((c) => c.id === newCard.id)) return st;
          return {
            ...st,
            cards: [newCard, ...st.cards],
            total_count: st.total_count + 1,
          };
        }
        return st;
      }),
    );
    startTransition(() => {
      router.refresh();
    });
  };

  const handleOpenConversation = (card: KanbanCard) => {
    setNotification(null);
    startTransition(async () => {
      const res = await openOrCreateOpportunityConversationAction(card.id);
      if (res.success) {
        router.push(`/conversas/${res.conversationId}`);
      } else {
        setNotification({
          type: "error",
          message:
            res.error ||
            "Não foi possível abrir a conversa. Verifique se este contato possui um telefone WhatsApp válido e se o WhatsApp está conectado.",
        });
      }
    });
  };

  const handleCopyLink = (card: KanbanCard) => {
    const url = `${window.location.origin}/kanban?opportunityId=${card.id}`;
    navigator.clipboard.writeText(url);
    setNotification({
      type: "success",
      message: `Link da oportunidade "${card.title}" copiado para a área de transferência!`,
    });
  };

  const handleArchiveOpportunity = (opportunityId: string) => {
    snapshotRef.current = stages;

    setStages((prevStages) =>
      prevStages.map((st) => ({
        ...st,
        cards: st.cards.filter((c) => c.id !== opportunityId),
        total_count: st.cards.some((c) => c.id === opportunityId)
          ? Math.max(0, st.total_count - 1)
          : st.total_count,
      })),
    );

    setPendingCardIds((prev) => new Set(prev).add(opportunityId));

    startTransition(async () => {
      try {
        const res = await archiveOpportunityAction(opportunityId);
        if (!res.success) {
          setStages(snapshotRef.current);
          setNotification({
            type: "error",
            message: res.error || "Falha ao arquivar oportunidade.",
          });
        } else {
          setNotification({
            type: "success",
            message: "Oportunidade arquivada com sucesso.",
          });
        }
      } catch (err) {
        console.error("Erro ao arquivar oportunidade:", err);
        setStages(snapshotRef.current);
        setNotification({
          type: "error",
          message: "Erro inesperado ao conectar ao servidor.",
        });
      } finally {
        setPendingCardIds((prev) => {
          const next = new Set(prev);
          next.delete(opportunityId);
          return next;
        });
      }
    });
  };

  const handleUpdateOpportunityLocally = (updatedCard: KanbanCard) => {
    setStages((prevStages) =>
      prevStages.map((st) => ({
        ...st,
        cards: st.cards.map((c) => (c.id === updatedCard.id ? updatedCard : c)),
      })),
    );
  };

  const handleMoveStage = (
    cardId: string,
    fromStageId: string,
    toStageId: string,
    beforeOpportunityId: string | null = null,
  ) => {
    snapshotRef.current = stages;

    let movedCard: KanbanCard | null = null;

    setStages((prevStages) =>
      prevStages
        .map((stage) => {
          if (stage.id === fromStageId) {
            const found = stage.cards.find((c) => c.id === cardId);
            if (found) movedCard = { ...found, updated_at: new Date().toISOString() };
            return {
              ...stage,
              cards: stage.cards.filter((c) => c.id !== cardId),
            };
          }
          return stage;
        })
        .map((stage) => {
          if (stage.id === toStageId && movedCard) {
            return {
              ...stage,
              cards: reorderCards(stage.cards, cardId, beforeOpportunityId).map((card) =>
                card.id === movedCard?.id ? movedCard : card,
              ),
            };
          }
          return stage;
        }),
    );

    setPendingCardIds((prev) => new Set(prev).add(cardId));
    setNotification(null);

    startTransition(async () => {
      try {
        const res = await reorderOpportunityAction(cardId, fromStageId, toStageId, beforeOpportunityId);

        if (!res.success) {
          setStages(snapshotRef.current);

          if (res.code === "CONFLICT") {
            router.refresh();
            setNotification({
              type: "warning",
              message:
                res.error ||
                "A oportunidade foi alterada por outra operação. Estado atualizado.",
            });
          } else {
            setNotification({
              type: "error",
              message: res.error || "Falha ao movimentar a oportunidade.",
            });
          }
        }
      } catch (err) {
        console.error("Erro na movimentação do Kanban:", err);
        setStages(snapshotRef.current);
        setNotification({
          type: "error",
          message: "Erro inesperado ao conectar ao servidor.",
        });
      } finally {
        setPendingCardIds((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Barra Superior de Ações */}
      <div className="flex flex-col gap-stack rounded-card border border-border bg-surface p-card sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-semibold text-text">
            Pipeline Comercial
          </span>
          <span className="rounded-pill bg-neutral-soft px-2.5 py-0.5 text-caption font-medium text-text-muted border border-border">
            {totalCards} {totalCards === 1 ? "oportunidade ativa" : "oportunidades ativas"}
          </span>
        </div>

        <Button
          className="w-full sm:w-auto shrink-0"
          onClick={() => setIsCreateOpen(true)}
          variant="primary"
        >
          <Plus aria-hidden="true" size={17} />
          <span>Nova Oportunidade</span>
        </Button>
      </div>

      {/* Região aria-live / Notificações de Status */}
      {notification ? (
        <div
          aria-live="polite"
          className={`flex items-center justify-between rounded-control p-card text-body font-medium border ${
            notification.type === "warning"
              ? "bg-warning-soft text-warning border-warning-border"
              : notification.type === "error"
              ? "bg-danger-soft text-danger border-danger-border"
              : notification.type === "success"
              ? "bg-success-soft text-success border-success-border"
              : "bg-info-soft text-info border-info-border"
          }`}
          role="status"
        >
          <span>{notification.message}</span>
          <button
            aria-label="Fechar notificação"
            className="flex size-7 items-center justify-center rounded-control text-text-muted hover:bg-black/5 hover:text-text font-bold"
            onClick={() => setNotification(null)}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}

      {/* Quadro Kanban (Colunas) com Snap suave no mobile */}
      <div
        className={`flex gap-3 sm:gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-4 pt-1 items-start min-h-[calc(100vh-220px)] touch-pan-x ${
          isGrabbing ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
        data-testid="kanban-board-container"
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseUpOrLeave}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        ref={boardContainerRef}
      >
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.id}
            onArchiveOpportunity={handleArchiveOpportunity}
            onCardClick={handleCardClick}
            onCopyLink={handleCopyLink}
            onDropCard={handleMoveStage}
            onMoveStage={handleMoveStage}
            onOpenConversation={handleOpenConversation}
            pendingCardIds={pendingCardIds}
            stage={stage}
            stages={stageOptions}
            userRole={userRole}
          />
        ))}
      </div>

      {/* Modal de Criação */}
      <CreateOpportunityDialog
        contacts={contacts}
        isOpen={isCreateOpen}
        members={members}
        onClose={() => setIsCreateOpen(false)}
        onCreated={handleCreatedOpportunity}
        stages={stageOptions}
      />

      {/* Drawer Lateral de Detalhes e Edição */}
      <OpportunityDetailDrawer
        card={selectedCard}
        contacts={contactOptions}
        members={memberOptions}
        onArchiveOpportunity={handleArchiveOpportunity}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateOpportunity={handleUpdateOpportunityLocally}
        open={isDrawerOpen}
        stages={stages}
        userRole={userRole}
      />
    </div>
  );
}
