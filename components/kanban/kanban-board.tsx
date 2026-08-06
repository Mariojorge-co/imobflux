"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  archiveOpportunityAction,
  moveOpportunityAction,
  openOrCreateOpportunityConversationAction,
} from "@/lib/kanban/actions";
import type { ContactSelectItem, MemberSelectItem } from "@/lib/kanban/data";
import { Button } from "@/components/ui";
import type { ContactClassification, KanbanCard, KanbanStage } from "@/types/kanban";

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
      target.closest("[role='dialog']")
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
    // Captura snapshot seguro antes da mutação otimista
    snapshotRef.current = stages;

    // Atualização otimista local: remove o card
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
          // Rollback usando snapshot imediatamente anterior
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
  ) => {
    if (fromStageId === toStageId) return;

    // Captura snapshot imediatamente anterior à mutação otimista
    snapshotRef.current = stages;

    let movedCard: KanbanCard | null = null;

    // 1. Atualização otimista imediata no estado local
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
              cards: [movedCard, ...stage.cards],
            };
          }
          return stage;
        }),
    );

    setPendingCardIds((prev) => new Set(prev).add(cardId));
    setNotification(null);

    // 2. Executa Server Action em transição
    startTransition(async () => {
      try {
        const res = await moveOpportunityAction(cardId, fromStageId, toStageId);

        if (!res.success) {
          // Rollback usando o snapshot imediatamente anterior
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
        } else if (res.status === "no_change") {
          setNotification({
            type: "info",
            message: "A oportunidade já estava na etapa selecionada.",
          });
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
      <div className="flex items-center justify-between gap-4 bg-surface p-card rounded-card border border-border">
        <div className="flex items-center gap-2">
          <span className="text-body font-semibold text-text">
            Pipeline Comercial
          </span>
          <span className="text-caption text-text-muted">
            ({stages.reduce((acc, s) => acc + s.cards.length, 0)} oportunidades ativas)
          </span>
        </div>

        <Button onClick={() => setIsCreateOpen(true)} variant="primary">
          <Plus className="h-4 w-4" />
          <span>Nova Oportunidade</span>
        </Button>
      </div>

      {/* Região aria-live / Notificações de Status */}
      {notification ? (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center justify-between rounded-control p-card text-body font-medium border ${
            notification.type === "warning"
              ? "bg-warning-soft text-warning border-warning"
              : notification.type === "error"
              ? "bg-danger-soft text-danger border-danger"
              : notification.type === "success"
              ? "bg-success-soft text-success border-success"
              : "bg-info-soft text-info border-info"
          }`}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-text-muted hover:text-text font-bold px-1"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Quadro Kanban (Colunas) */}
      <div
        ref={boardContainerRef}
        data-testid="kanban-board-container"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        className={`flex gap-4 overflow-x-auto pb-4 pt-1 items-start min-h-[calc(100vh-200px)] touch-pan-x ${
          isGrabbing ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
      >
        {stages.map((stage) => (
          <KanbanColumn
            key={stage.id}
            stage={stage}
            stages={stageOptions}
            userRole={userRole}
            onDropCard={handleMoveStage}
            onMoveStage={handleMoveStage}
            onCardClick={handleCardClick}
            onOpenConversation={handleOpenConversation}
            onCopyLink={handleCopyLink}
            onArchiveOpportunity={handleArchiveOpportunity}
            pendingCardIds={pendingCardIds}
          />
        ))}
      </div>

      {/* Modal de Criação */}
      <CreateOpportunityDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        stages={stageOptions}
        contacts={contacts}
        members={members}
        onCreated={handleCreatedOpportunity}
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
