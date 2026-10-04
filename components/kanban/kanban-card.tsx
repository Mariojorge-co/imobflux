"use client";

import { useId, useRef, useState } from "react";
import {
  Archive,
  Banknote,
  Copy,
  MessageCircle,
  MoreVertical,
  MoveRight,
  Tag,
  User,
  UserCheck,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/date";
import type { KanbanCard as KanbanCardType } from "@/types/kanban";
import { ViewportMenu } from "@/components/ui";

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
  isDropTarget?: boolean;
}

function formatCardValue(card: KanbanCardType): string | null {
  if (card.approved_amount && card.approved_amount > 0) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(card.approved_amount);
  }
  if (card.value_range_preference && card.value_range_preference.trim()) {
    return card.value_range_preference.trim();
  }
  return null;
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
  isDropTarget = false,
}: KanbanCardProps) {
  const [showMoveSelect, setShowMoveSelect] = useState(false);
  const [showKebabMenu, setShowKebabMenu] = useState(false);
  const kebabButtonRef = useRef<HTMLButtonElement>(null);
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
    const target = e.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("select") ||
      target.closest("label") ||
      target.closest("a") ||
      target.closest("[role='menu']")
    ) {
      return;
    }
    if (onCardClick) {
      onCardClick(card);
    }
  };

  const availableTargetStages = stages.filter((s) => s.id !== currentStageId);
  const isOwner = userRole === "owner";
  const closeKebabMenu = () => {
    setShowKebabMenu(false);
    requestAnimationFrame(() => kebabButtonRef.current?.focus());
  };

  const cardValue = formatCardValue(card);
  const cardResponsible = card.responsible_name;
  const cardOrigin = !cardValue || !cardResponsible ? card.origin : null;

  return (
    <div
      className={`group relative rounded-card border border-border bg-surface p-3 text-text shadow-xs transition-all hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        isDropTarget ? "border-t-4 border-t-primary ring-2 ring-primary/20" : ""
      } ${
        isPending ? "opacity-50 pointer-events-none" : "cursor-pointer"
      }`}
      data-kanban-card-id={card.id}
      data-testid={`kanban-card-${card.id}`}
      draggable={!isPending}
      onClick={handleCardClick}
      onDragStart={handleDragStart}
    >
      {/* Menu Kebab (⋮) */}
      <div className="absolute top-2.5 right-2 z-10">
        <button
          aria-expanded={showKebabMenu}
          aria-haspopup="true"
          aria-label={`Ações da oportunidade ${card.title}`}
          className="flex size-7 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          disabled={isPending}
          id={`kanban-actions-${card.id}`}
          onClick={(e) => {
            e.stopPropagation();
            setShowKebabMenu((prev) => !prev);
          }}
          ref={kebabButtonRef}
          type="button"
        >
          <MoreVertical aria-hidden="true" size={15} />
        </button>

        <ViewportMenu
          anchorRef={kebabButtonRef}
          labelledBy={`kanban-actions-${card.id}`}
          onClose={closeKebabMenu}
          open={showKebabMenu}
        >
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  closeKebabMenu();
                  if (onOpenConversation) onOpenConversation(card);
                }}
                role="menuitem"
                type="button"
              >
                <MessageCircle aria-hidden="true" className="text-success" size={15} />
                <span>Abrir conversa</span>
              </button>

              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  closeKebabMenu();
                  if (onCardClick) onCardClick(card);
                }}
                role="menuitem"
                type="button"
              >
                <User aria-hidden="true" className="text-text-muted" size={15} />
                <span>Ver detalhes</span>
              </button>

              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
                onClick={(e) => {
                  e.stopPropagation();
                  closeKebabMenu();
                  if (onCopyLink) onCopyLink(card);
                }}
                role="menuitem"
                type="button"
              >
                <Copy aria-hidden="true" className="text-text-muted" size={15} />
                <span>Copiar link</span>
              </button>

              {isOwner ? (
                <button
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-body text-danger hover:bg-danger-soft focus-visible:bg-danger-soft focus-visible:outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeKebabMenu();
                    if (onArchiveOpportunity) onArchiveOpportunity(card.id);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Archive aria-hidden="true" size={15} />
                  <span>Arquivar oportunidade</span>
                </button>
              ) : null}
        </ViewportMenu>
      </div>

      {/* Título da Oportunidade */}
      <button
        className="block w-full pr-7 text-left text-body font-semibold text-text line-clamp-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        disabled={isPending}
        onClick={(event) => {
          event.stopPropagation();
          onCardClick?.(card);
        }}
        type="button"
      >
        {card.title}
      </button>

      {/* Nome do Contato */}
      <div className="mt-1.5 flex items-center gap-1.5 text-caption text-text-muted">
        <User aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
        <span className="font-medium text-text truncate" title={card.contact_name}>
          {card.contact_name}
        </span>
      </div>

      {/* Metadados adicionais (máx 2: Valor, Responsável ou Origem) */}
      {(cardValue || cardResponsible || cardOrigin) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-border/70 text-caption">
          {cardValue ? (
            <span
              className="inline-flex items-center gap-1 rounded-control bg-success-soft px-1.5 py-0.5 font-medium text-success border border-success-border"
              title={`Valor: ${cardValue}`}
            >
              <Banknote aria-hidden="true" size={12} />
              <span className="truncate max-w-[120px]">{cardValue}</span>
            </span>
          ) : null}

          {cardResponsible ? (
            <span
              className="inline-flex items-center gap-1 rounded-control bg-neutral-soft px-1.5 py-0.5 font-medium text-neutral border border-neutral-border"
              title={`Responsável: ${cardResponsible}`}
            >
              <UserCheck aria-hidden="true" size={12} />
              <span className="truncate max-w-[100px]">{cardResponsible}</span>
            </span>
          ) : null}

          {(!cardValue || !cardResponsible) && cardOrigin ? (
            <span
              className="inline-flex items-center gap-1 rounded-control bg-neutral-soft px-1.5 py-0.5 text-text-muted border border-border"
              title={`Origem: ${cardOrigin}`}
            >
              <Tag aria-hidden="true" size={11} />
              <span className="truncate max-w-[90px]">{cardOrigin}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Rodapé do Card: Data e Ação Acessível de Mover */}
      <div className="mt-2 flex items-center justify-between text-caption text-text-muted pt-1 border-t border-border/50">
        <span>{formatRelativeTime(card.updated_at)}</span>

        {/* Alternativa Acessível de Movimentação */}
        {availableTargetStages.length > 0 ? (
          <div className="relative">
            {!showMoveSelect ? (
              <button
                aria-label={`Mover oportunidade ${card.title} para outra etapa`}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium text-primary hover:bg-neutral-soft hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                disabled={isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMoveSelect(true);
                }}
                type="button"
              >
                <span>Mover</span>
                <MoveRight aria-hidden="true" size={12} />
              </button>
            ) : (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <label className="sr-only" htmlFor={selectId}>
                  Selecione a etapa de destino
                </label>
                <select
                  className="rounded border border-border bg-surface px-1 py-0.5 text-caption text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  defaultValue=""
                  disabled={isPending}
                  id={selectId}
                  onBlur={() => setShowMoveSelect(false)}
                  onChange={(e) => {
                    if (e.target.value) {
                      onMoveStage(card.id, currentStageId, e.target.value);
                      setShowMoveSelect(false);
                    }
                  }}
                >
                  <option disabled value="">
                    Etapa...
                  </option>
                  {availableTargetStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  aria-label="Cancelar seleção de etapa"
                  className="px-1 text-caption text-text-muted hover:text-text"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMoveSelect(false);
                  }}
                  type="button"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
