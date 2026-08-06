"use client";

import { useId, useState } from "react";
import { Archive, Copy, MessageCircle, MoreVertical, MoveRight, User, UserCheck } from "lucide-react";
import { formatRelativeTime } from "@/lib/date";
import type { KanbanCard as KanbanCardType } from "@/types/kanban";

interface KanbanCardProps {
  card: KanbanCardType;
  currentStageId: string;
  stages: { id: string; name: string }[];
  userRole?: string;
  onMoveStage: (cardId: string, fromStageId: string, toStageId: string) => void;
  onCardClick?: (card: KanbanCardType) => void;
  onOpenConversation?: (card: KanbanCardType) => void;
  onCopyLink?: (card: KanbanCardType) => void;
  onArchiveOpportunity?: (cardId: string) => void;
  isPending?: boolean;
}

export function KanbanCard({
  card,
  currentStageId,
  stages,
  userRole = "owner",
  onMoveStage,
  onCardClick,
  onOpenConversation,
  onCopyLink,
  onArchiveOpportunity,
  isPending = false,
}: KanbanCardProps) {
  const [showMoveSelect, setShowMoveSelect] = useState(false);
  const [showKebabMenu, setShowKebabMenu] = useState(false);
  const selectId = useId();

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (isPending) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        cardId: card.id,
        fromStageId: currentStageId,
      }),
    );
    e.dataTransfer.effectAllowed = "move";
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Evita abrir o drawer se o clique ocorreu em botões ou menuzinhos internos
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("select") || target.closest("label")) {
      return;
    }
    if (onCardClick) {
      onCardClick(card);
    }
  };

  const availableTargetStages = stages.filter((s) => s.id !== currentStageId);
  const isOwner = userRole === "owner";

  return (
    <div
      draggable={!isPending}
      onClick={handleCardClick}
      onDragStart={handleDragStart}
      data-testid={`kanban-card-${card.id}`}
      className={`group relative rounded-card border border-border bg-surface p-card text-text shadow-sm transition-all hover:border-primary hover:shadow-md ${
        isPending ? "opacity-50 pointer-events-none" : "cursor-pointer"
      }`}
    >
      {/* Botão do Menu Kebab (⋮) */}
      <div className="absolute top-2 right-2 z-10">
        <button
          type="button"
          aria-label={`Menu de ações da oportunidade ${card.title}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowKebabMenu((prev) => !prev);
          }}
          disabled={isPending}
          className="rounded p-1 text-text-muted hover:bg-neutral-soft hover:text-text transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {/* Menu Dropdown Kebab */}
        {showKebabMenu ? (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={(e) => {
                e.stopPropagation();
                setShowKebabMenu(false);
              }}
            />
            <div className="absolute right-0 top-6 z-30 min-w-[11rem] rounded-card border border-border bg-surface py-1 text-body shadow-lg">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text hover:bg-neutral-soft transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowKebabMenu(false);
                  if (onOpenConversation) onOpenConversation(card);
                }}
              >
                <MessageCircle className="h-4 w-4 text-primary" />
                <span>Abrir conversa</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text hover:bg-neutral-soft transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowKebabMenu(false);
                  if (onCardClick) onCardClick(card);
                }}
              >
                <User className="h-4 w-4 text-text-muted" />
                <span>Editar oportunidade</span>
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text hover:bg-neutral-soft transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowKebabMenu(false);
                  if (onCopyLink) onCopyLink(card);
                }}
              >
                <Copy className="h-4 w-4 text-text-muted" />
                <span>Copiar link</span>
              </button>

              {isOwner ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-body text-danger hover:bg-danger-soft transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowKebabMenu(false);
                    if (onArchiveOpportunity) onArchiveOpportunity(card.id);
                  }}
                >
                  <Archive className="h-4 w-4" />
                  <span>Arquivar oportunidade</span>
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {/* Título da Oportunidade */}
      <h4 className="text-body font-semibold text-text line-clamp-2 pr-6">
        {card.title}
      </h4>

      {/* Descrição opcional */}
      {card.description ? (
        <p className="mt-1 text-caption text-text-muted line-clamp-2">
          {card.description}
        </p>
      ) : null}

      {/* Detalhes do Contato */}
      <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2 text-caption text-text-muted">
        <div className="flex items-center gap-1.5 truncate">
          <User className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="font-medium text-text truncate" title={card.contact_name}>
            {card.contact_name}
          </span>
        </div>

        {/* Responsável */}
        {card.responsible_name ? (
          <div
            className="flex items-center gap-1 text-caption text-text-muted shrink-0 bg-neutral-soft px-1.5 py-0.5 rounded-control"
            title={`Responsável: ${card.responsible_name}`}
          >
            <UserCheck className="h-3 w-3 text-primary" />
            <span className="max-w-[80px] truncate">{card.responsible_name}</span>
          </div>
        ) : null}
      </div>

      {/* Rodapé do Card: Data e Ações Mobile/Teclado */}
      <div className="mt-2 flex items-center justify-between text-caption text-text-muted">
        <span>{formatRelativeTime(card.updated_at)}</span>

        {/* Botão de Alternativa de Movimentação sem Drag-and-Drop */}
        {availableTargetStages.length > 0 ? (
          <div className="relative">
            {!showMoveSelect ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMoveSelect(true);
                }}
                disabled={isPending}
                aria-label={`Mover oportunidade ${card.title} para outra etapa`}
                className="flex items-center gap-1 text-primary hover:underline font-medium px-1 py-0.5 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <span>Mover</span>
                <MoveRight className="h-3 w-3" />
              </button>
            ) : (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <label htmlFor={selectId} className="sr-only">
                  Selecione a etapa de destino
                </label>
                <select
                  id={selectId}
                  disabled={isPending}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      onMoveStage(card.id, currentStageId, e.target.value);
                      setShowMoveSelect(false);
                    }
                  }}
                  onBlur={() => setShowMoveSelect(false)}
                  className="text-caption bg-surface border border-border rounded px-1 py-0.5 text-text focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="" disabled>
                    Selecione a etapa...
                  </option>
                  {availableTargetStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoveSelect(false);
                  }}
                  className="text-text-muted hover:text-text text-caption px-1"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
