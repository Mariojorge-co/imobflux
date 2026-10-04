"use client";

import { useState } from "react";
import type { KanbanCard as KanbanCardType, KanbanStage } from "@/types/kanban";
import { KanbanCard } from "./kanban-card";

interface KanbanColumnProps {
  stage: KanbanStage;
  stages: { id: string; name: string }[];
  userRole?: string;
  onDropCard: (cardId: string, fromStageId: string, toStageId: string, beforeOpportunityId: string | null) => void;
  onMoveStage: (cardId: string, fromStageId: string, toStageId: string) => void;
  onCardClick?: (card: KanbanCardType) => void;
  onOpenConversation?: (card: KanbanCardType) => void;
  onCopyLink?: (card: KanbanCardType) => void;
  onArchiveOpportunity?: (cardId: string) => void;
  pendingCardIds: Set<string>;
}

export function KanbanColumn({
  stage,
  stages,
  userRole = "owner",
  onDropCard,
  onMoveStage,
  onCardClick,
  onOpenConversation,
  onCopyLink,
  onArchiveOpportunity,
  pendingCardIds,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [insertionBeforeId, setInsertionBeforeId] = useState<string | null>(null);

  const calculateInsertion = (event: React.DragEvent<HTMLDivElement>) => {
    const cardElement = (event.target as HTMLElement).closest<HTMLElement>("[data-kanban-card-id]");
    if (!cardElement) return null;
    const hoveredId = cardElement.dataset.kanbanCardId;
    if (!hoveredId) return null;
    const rect = cardElement.getBoundingClientRect();
    const insertBefore = event.clientY < rect.top + rect.height / 2;
    if (insertBefore) return hoveredId;
    const index = stage.cards.findIndex((card) => card.id === hoveredId);
    return stage.cards[index + 1]?.id ?? null;
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isDragOver) setIsDragOver(true);
    setInsertionBeforeId(calculateInsertion(e));
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
    setInsertionBeforeId(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    try {
      const dataStr = e.dataTransfer.getData("application/json");
      if (!dataStr) return;

      const { cardId, fromStageId } = JSON.parse(dataStr);
      if (cardId && fromStageId) {
        onDropCard(cardId, fromStageId, stage.id, insertionBeforeId ?? calculateInsertion(e));
      }
    } catch (err) {
      console.error("Erro ao processar drop no KanbanColumn:", err);
    }
  };

  return (
    <div
      aria-label={`Coluna ${stage.name}`}
      className={`flex w-[82vw] max-w-[320px] sm:w-72 md:w-80 shrink-0 snap-start flex-col rounded-card border bg-neutral-soft/40 p-3 transition-colors ${
        isDragOver
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "border-border"
      }`}
      data-testid={`kanban-column-${stage.id}`}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="region"
    >
      {/* Cabeçalho da Coluna */}
      <div className="flex items-center justify-between pb-2.5 border-b border-border mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-text text-body">{stage.name}</h3>
          <span
            aria-label={`${stage.cards.length} oportunidades nesta coluna`}
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-neutral-soft px-1.5 text-caption font-semibold text-text border border-border"
          >
            {stage.cards.length}
          </span>
        </div>

        {stage.has_more ? (
          <span
            className="text-caption font-medium text-warning bg-warning-soft border border-warning-border px-1.5 py-0.5 rounded-control"
            title={`Exibindo as 50 oportunidades mais recentes de um total de ${stage.total_count}`}
          >
            50+
          </span>
        ) : null}
      </div>

      {/* Lista de Cards da Coluna */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto min-h-[150px] max-h-[calc(100vh-220px)] pr-0.5">
        {stage.cards.length === 0 ? (
          <div className="flex h-24 items-center justify-center rounded-card border border-dashed border-border bg-surface/50 text-caption text-text-muted">
            Nenhuma oportunidade nesta etapa
          </div>
        ) : (
          stage.cards.map((card) => (
            <KanbanCard
              card={card}
              currentStageId={stage.id}
              isPending={pendingCardIds.has(card.id)}
              isDropTarget={insertionBeforeId === card.id}
              key={card.id}
              onArchiveOpportunity={onArchiveOpportunity}
              onCardClick={onCardClick}
              onCopyLink={onCopyLink}
              onMoveStage={onMoveStage}
              onOpenConversation={onOpenConversation}
              stages={stages}
              userRole={userRole}
            />
          ))
        )}
        {isDragOver && insertionBeforeId === null ? (
          <div aria-hidden="true" className="h-1 rounded-full bg-primary/70" />
        ) : null}
      </div>
    </div>
  );
}
