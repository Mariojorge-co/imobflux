"use client";

import { useState } from "react";
import type { KanbanCard as KanbanCardType, KanbanStage } from "@/types/kanban";
import { KanbanCard } from "./kanban-card";

interface KanbanColumnProps {
  stage: KanbanStage;
  stages: { id: string; name: string }[];
  userRole?: string;
  onDropCard: (cardId: string, fromStageId: string, toStageId: string) => void;
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

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    try {
      const dataStr = e.dataTransfer.getData("application/json");
      if (!dataStr) return;

      const { cardId, fromStageId } = JSON.parse(dataStr);
      if (cardId && fromStageId) {
        onDropCard(cardId, fromStageId, stage.id);
      }
    } catch (err) {
      console.error("Erro ao processar drop no KanbanColumn:", err);
    }
  };

  return (
    <div
      role="region"
      aria-label={`Coluna ${stage.name}`}
      data-testid={`kanban-column-${stage.id}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex w-72 flex-col rounded-card border bg-neutral-soft/50 p-card shrink-0 transition-colors ${
        isDragOver
          ? "border-primary bg-primary/5 ring-2 ring-primary/20"
          : "border-border"
      }`}
    >
      {/* Cabeçalho da Coluna */}
      <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-text text-body">{stage.name}</h3>
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-border px-1.5 text-caption font-semibold text-text"
            aria-label={`${stage.cards.length} oportunidades nesta coluna`}
          >
            {stage.cards.length}
          </span>
        </div>

        {stage.has_more ? (
          <span
            className="text-caption font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-control"
            title={`Exibindo as 50 oportunidades mais recentes de um total de ${stage.total_count}`}
          >
            50+
          </span>
        ) : null}
      </div>

      {/* Lista de Cards da Coluna */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto min-h-[150px] max-h-[calc(100vh-220px)] pr-1">
        {stage.cards.length === 0 ? (
          <div className="flex h-28 items-center justify-center rounded-card border border-dashed border-border text-caption text-text-muted">
            Nenhuma oportunidade
          </div>
        ) : (
          stage.cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              currentStageId={stage.id}
              stages={stages}
              userRole={userRole}
              onMoveStage={onMoveStage}
              onCardClick={onCardClick}
              onOpenConversation={onOpenConversation}
              onCopyLink={onCopyLink}
              onArchiveOpportunity={onArchiveOpportunity}
              isPending={pendingCardIds.has(card.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
