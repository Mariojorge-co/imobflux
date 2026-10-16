"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, CornerUpLeft, CornerUpRight, EyeOff, Forward, History, Paperclip, Pencil, RotateCw, SmilePlus, Trash2 } from "lucide-react";
import { AttachmentView } from "@/components/conversations/attachment-view";
import { BottomSheet, SheetItem } from "@/components/ui/bottom-sheet";
import { useIsCompact } from "@/lib/ui/use-compact";
import { EmojiPicker } from "@/components/conversations/emoji-picker";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { Reply } from "lucide-react";
import { isReplyGestureTarget, swipeTriggered, updateSwipe, type SwipeState } from "@/lib/conversations/reply-gesture";
import { ESCAPE_PRIORITY, useEscapeLayer } from "@/lib/ui/escape-stack";
import { isStickerMessage } from "@/lib/conversations/sticker";
import { outgoingStatusLabel } from "@/lib/conversations/message-merge";
import type { ConversationMessage } from "@/lib/conversations/data";
import {
  groupReactions,
  messageCapabilities,
  quoteAuthorLabel,
  replyPreviewText,
  splitForHighlight,
  type Viewer,
} from "@/lib/conversations/message-ui";

type MenuEntry = { key: string; label: string; icon: React.ReactNode; testId: string; danger?: boolean; separatorBefore?: boolean; onClick: () => void };

export type MessageBubbleActions = {
  onRetry?: (message: ConversationMessage) => void;
  onDiscard?: (message: ConversationMessage) => void;
  onReply?: (message: ConversationMessage) => void;
  onEdit?: (message: ConversationMessage) => void;
  onDeleteForEveryone?: (message: ConversationMessage) => void;
  onHide?: (message: ConversationMessage) => void;
  onForward?: (message: ConversationMessage) => void;
  onReact?: (message: ConversationMessage, emoji: string) => void;
  onCopy?: (message: ConversationMessage) => void;
  /** Duplo clique ou deslize para responder (o painel confere edição e gravação antes de abrir a resposta). */
  onQuickReply?: (message: ConversationMessage) => void;
  /** Clicou na citação: rolar até a mensagem original e destacá-la. */
  onJumpToQuoted?: (messageId: string) => void;
  /** Só o dono: texto anterior / original apagado. */
  onViewHistory?: (message: ConversationMessage) => void;
};

type MessageBubbleProps = MessageBubbleActions & {
  message: ConversationMessage;
  isOutgoing: boolean;
  viewer?: Viewer | null;
  isGroup?: boolean;
  /** Termo da busca na conversa: os trechos que casam ficam destacados. */
  highlight?: string;
};

/** Texto com os trechos buscados destacados. */
function Highlighted({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>;
  return (
    <>
      {splitForHighlight(text, term).map((part, index) =>
        part.match ? (
          <mark className="rounded-sm bg-warning-soft px-0.5 text-text" data-testid="search-mark" key={index}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** A marca "enviada ao WhatsApp" vale por no máximo 60 s depois da ação aceita pela Evolution; depois a bolha fica normal. */
const PENDING_MARK_MS = 60_000;

function usePendingMark(action: string | null | undefined, since: string | null | undefined): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!action || !since) return;
    const left = PENDING_MARK_MS - (Date.now() - new Date(since).getTime());
    if (left <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), left + 50);
    return () => window.clearTimeout(timer);
  }, [action, since]);
  return Boolean(action && since && now - new Date(since).getTime() < PENDING_MARK_MS);
}

export function MessageBubble({
  message,
  isOutgoing,
  viewer = null,
  isGroup = false,
  highlight,
  onRetry,
  onDiscard,
  onReply,
  onEdit,
  onDeleteForEveryone,
  onHide,
  onForward,
  onReact,
  onCopy,
  onJumpToQuoted,
  onViewHistory,
  onQuickReply,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const swipeRef = useRef<SwipeState | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const showPendingMark = usePendingMark(message.wa_pending_action, message.deleted_at ?? message.edited_at);

  // Fecha o menu ao clicar fora; o Esc fecha uma camada por vez: primeiro o menu, depois o seletor de emoji.
  useEffect(() => {
    if (!menuOpen && !pickerOpen) return;
    const close = (event: Event) => {
      // O menu e o seletor de emoji (portal) e a folha do celular ficam fora da bolha: tocar neles não é "clicar fora".
      if (event.target instanceof Element && event.target.closest("[data-floating-menu], [data-bottom-sheet]")) return;
      if (wrapperRef.current && event.target instanceof Node && !wrapperRef.current.contains(event.target)) {
        setMenuOpen(false);
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen, pickerOpen]);
  useEscapeLayer(menuOpen, ESCAPE_PRIORITY.messageMenu, () => setMenuOpen(false));
  useEscapeLayer(pickerOpen, ESCAPE_PRIORITY.emojiPicker, () => setPickerOpen(false));

  // Tentar de novo: mensagem do CRM que falhou (a nova tentativa é uma nova mensagem). Arquivo só se já foi gravado
  // no servidor (id real); senão só dá para remover a bolha.
  const isLocalMedia = Boolean(message.attachments?.[0]?.id.startsWith("local-"));
  const canRetry = Boolean(
    onRetry && isOutgoing && message.status === "failed" && message.origin === "crm" && !message.is_history
      && message.text_content?.trim() && !isLocalMedia,
  );
  const canDiscard = Boolean(onDiscard && isOutgoing && message.status === "failed" && isLocalMedia);
  const deliveryState = outgoingStatusLabel(message);
  const timeLabel = new Date(message.occurred_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const capabilities = messageCapabilities(message, viewer, { isGroup });
  const hasAnyAction = Object.values(capabilities).some(Boolean);
  const reactions = groupReactions(message.reactions);
  const myReaction = message.reactions?.find((reaction) => reaction.mine)?.emoji ?? null;
  const deleted = Boolean(message.deleted_at);

  const canQuickReply = Boolean(onQuickReply && capabilities.canReply && !deleted && deliveryState !== "sending");

  const triggerQuickReply = () => {
    window.getSelection()?.removeAllRanges();
    onQuickReply?.(message);
  };

  // Duplo clique (mouse) = Responder. Não vale em link, botão, mídia, menu aberto nem mensagem apagada.
  const handleDoubleClick = (event: React.MouseEvent) => {
    if (!canQuickReply || menuOpen || pickerOpen || !isReplyGestureTarget(event.target)) return;
    event.preventDefault();
    triggerQuickReply();
  };

  // Deslizar para a direita (toque) = Responder. A rolagem vertical continua do navegador (touch-action: pan-y).
  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch" || !canQuickReply || menuOpen || !isReplyGestureTarget(event.target)) return;
    swipeRef.current = { startX: event.clientX, startY: event.clientY, startAt: Date.now(), locked: "none" };
  };
  const handlePointerMove = (event: React.PointerEvent) => {
    const state = swipeRef.current;
    if (!state) return;
    const next = updateSwipe(state, event.clientX, event.clientY);
    state.locked = next.locked;
    if (next.locked === "vertical") {
      swipeRef.current = null;
      setSwipeOffset(0);
      return;
    }
    setSwipeOffset(next.offset);
  };
  const endSwipe = (event: React.PointerEvent) => {
    const state = swipeRef.current;
    swipeRef.current = null;
    const offset = swipeOffset;
    setSwipeOffset(0);
    if (!state || event.type === "pointercancel") return;
    if (swipeTriggered(state, offset, Date.now())) {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(15);
      triggerQuickReply();
    }
  };

  const run = (action?: (message: ConversationMessage) => void) => () => {
    setMenuOpen(false);
    action?.(message);
  };
  const pickEmoji = (emoji: string) => {
    setPickerOpen(false);
    onReact?.(message, emoji);
  };
  const compact = useIsCompact();
  const entries: MenuEntry[] = [
    ...(capabilities.canReply ? [{ key: "reply", label: "Responder", icon: <CornerUpLeft size={15} />, testId: "action-reply", onClick: run(onReply) }] : []),
    ...(capabilities.canReact ? [{ key: "react", label: "Reagir", icon: <SmilePlus size={15} />, testId: "action-react", onClick: () => { setMenuOpen(false); setPickerOpen(true); } }] : []),
    ...(capabilities.canCopy ? [{ key: "copy", label: "Copiar", icon: <Copy size={15} />, testId: "action-copy", onClick: run(onCopy) }] : []),
    ...(capabilities.canForward ? [{ key: "forward", label: "Encaminhar", icon: <Forward size={15} />, testId: "action-forward", onClick: run(onForward) }] : []),
    ...(capabilities.canEdit ? [{ key: "edit", label: "Editar", icon: <Pencil size={15} />, testId: "action-edit", onClick: run(onEdit) }] : []),
    ...(capabilities.canViewHistory ? [{ key: "history", label: deleted ? "Ver original" : "Ver histórico", icon: <History size={15} />, testId: "action-history", onClick: run(onViewHistory) }] : []),
    ...(capabilities.canDeleteForEveryone ? [{ key: "delete-all", label: "Apagar para todos", icon: <Trash2 size={15} />, testId: "action-delete-all", danger: true, separatorBefore: true, onClick: run(onDeleteForEveryone) }] : []),
    ...(capabilities.canHide ? [{ key: "hide", label: "Apagar para mim", icon: <EyeOff size={15} />, testId: "action-hide", danger: true, separatorBefore: !capabilities.canDeleteForEveryone, onClick: run(onHide) }] : []),
  ];

  // Toque prolongado na bolha abre o menu (como no WhatsApp), sem depender do botão.
  const pressTimer = useRef<number | null>(null);
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const startPress = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch" || !hasAnyAction) return;
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      setPickerOpen(false);
      setMenuOpen(true);
    }, 500);
  };

  // Figurinha: pequena, sem fundo/bolha, sem legenda, só um horário discreto.
  if (!deleted && isStickerMessage(message) && message.attachments?.[0]) {
    return (
      <div className={["flex", isOutgoing ? "justify-end" : "justify-start"].join(" ")} data-testid="sticker-message">
        <div className="flex max-w-[88%] flex-col gap-0.5">
          <AttachmentView attachment={message.attachments[0]} isOutgoing={isOutgoing} messageText={message.text_content} />
          <p className={["text-[11px] leading-none text-text-muted/70", isOutgoing ? "text-right" : "text-left"].join(" ")}>
            {deliveryState === "sending" ? "Enviando…" : deliveryState === "failed" ? "Não enviada" : timeLabel}
          </p>
        </div>
      </div>
    );
  }

  const muted = isOutgoing ? "text-primary-foreground/70" : "text-text-muted";

  return (
    <div
      className={[
        "group flex rounded-lg transition-colors",
        isOutgoing ? "justify-end" : "justify-start",
        canQuickReply ? "hover:bg-neutral-soft/40" : "",
      ].join(" ")}
      data-testid="message-row"
      onDoubleClick={handleDoubleClick}
      ref={wrapperRef}
    >
      <div
        className={["relative max-w-[88%] sm:max-w-[75%]", reactions.length > 0 ? "mb-3" : ""].join(" ")}
        data-testid="message-gesture-area"
        onPointerCancel={endSwipe}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endSwipe}
        style={{ touchAction: canQuickReply ? "pan-y" : undefined, transform: swipeOffset > 0 ? `translateX(${swipeOffset}px)` : undefined }}
      >
        {swipeOffset > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -left-9 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-soft text-text-muted"
            data-testid="swipe-reply-icon"
            style={{ opacity: Math.min(1, swipeOffset / 56) }}
          >
            <Reply size={16} />
          </span>
        ) : null}
        <div
          className={[
            "rounded-2xl px-3 py-2",
            isOutgoing
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-surface text-text shadow-sm ring-1 ring-border",
            message.is_history ? "border border-dashed border-border-strong opacity-80" : "",
          ].join(" ")}
          data-deleted={deleted ? "true" : undefined}
          onContextMenu={(event) => {
            if (compact && hasAnyAction) event.preventDefault();
          }}
          onPointerCancel={cancelPress}
          onPointerDown={startPress}
          onPointerLeave={cancelPress}
          onPointerUp={cancelPress}
          data-history={message.is_history ? "true" : undefined}
          data-testid="message-bubble"
        >
          {/* Identificação de autor interno no CRM (somente visível internamente) */}
          {isOutgoing && message.internal_author_name && (
            <p className="mb-0.5 text-caption font-semibold text-primary-foreground/80">
              Enviado por {message.internal_author_name}
            </p>
          )}

          {message.forwarded && !deleted ? (
            <p className={["mb-0.5 flex items-center gap-1 text-caption italic", muted].join(" ")} data-testid="forwarded-mark">
              <CornerUpRight aria-hidden="true" size={12} /> Encaminhada
            </p>
          ) : null}

          {/* Citação: a mensagem respondida. Clicar leva até ela (quando está carregada). */}
          {message.reply_snapshot && !deleted ? (
            <button
              className={[
                "mb-1.5 block w-full rounded-lg border-l-4 px-2 py-1 text-left text-caption",
                isOutgoing ? "border-primary-foreground/60 bg-white/10" : "border-primary bg-neutral-soft",
              ].join(" ")}
              data-testid="reply-quote"
              disabled={!message.reply_to_message_id}
              onClick={() => message.reply_to_message_id && onJumpToQuoted?.(message.reply_to_message_id)}
              type="button"
            >
              <span className={["block truncate font-semibold", isOutgoing ? "text-primary-foreground" : "text-primary"].join(" ")}>
                {quoteAuthorLabel(message.reply_snapshot, viewer)}
              </span>
              <span className={["block truncate", muted].join(" ")}>{replyPreviewText(message.reply_snapshot)}</span>
            </button>
          ) : null}

          {deleted ? (
            <p className={["flex items-center gap-1.5 text-sm italic", muted].join(" ")} data-testid="message-deleted">
              <Trash2 aria-hidden="true" size={13} /> Esta mensagem foi apagada
            </p>
          ) : (
            <>
              {message.attachments?.length
                ? message.attachments.map((attachment) => (
                    <div data-no-reply="" key={attachment.id}>
                      <AttachmentView attachment={attachment} isOutgoing={isOutgoing} messageText={message.text_content} />
                    </div>
                  ))
                : message.has_attachments && (
                    <div
                      aria-label="Esta mensagem contém um anexo indisponível"
                      className={[
                        "mb-1.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                        isOutgoing ? "bg-white/10 text-primary-foreground/70" : "bg-neutral-soft text-text-muted",
                      ].join(" ")}
                    >
                      <Paperclip aria-hidden="true" size={12} strokeWidth={1.8} />
                      <span>Anexo indisponível</span>
                    </div>
                  )}

              {message.text_content && (
                <p className="whitespace-pre-wrap break-words text-sm" data-testid="message-text">
                  <Highlighted term={highlight} text={message.text_content} />
                </p>
              )}
            </>
          )}

          <p
            className={["mt-1 text-right text-caption", isOutgoing ? "text-primary-foreground/60" : "text-text-muted"].join(" ")}
            data-testid={deliveryState ? `message-${deliveryState}` : undefined}
          >
            {message.edited_at && !deleted ? <span className="mr-1 italic" data-testid="edited-mark">editada</span> : null}
            {showPendingMark ? (
              <span className="mr-1 italic" data-testid="wa-pending" title="A Evolution aceitou; o WhatsApp deve refletir em instantes.">
                · enviada ao WhatsApp
              </span>
            ) : null}
            {deliveryState === "sending" ? "Enviando…" : deliveryState === "failed" ? "Não enviada" : timeLabel}
          </p>
          {deliveryState === "failed" ? (
            <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-caption text-primary-foreground/80" data-testid="message-failed-detail">
              {message.send_error ? <span className="break-words">{message.send_error}</span> : null}
              {canRetry ? (
                <button
                  className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
                  data-testid="message-retry"
                  onClick={() => onRetry?.(message)}
                  type="button"
                >
                  <RotateCw aria-hidden="true" size={12} /> Tentar de novo
                </button>
              ) : null}
              {canDiscard ? (
                <button
                  className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
                  data-testid="message-discard"
                  onClick={() => onDiscard?.(message)}
                  type="button"
                >
                  Remover
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Reações sob a bolha */}
        {reactions.length > 0 ? (
          <div
            className={["absolute -bottom-3 flex gap-1", isOutgoing ? "right-2" : "left-2"].join(" ")}
            data-testid="message-reactions"
          >
            {reactions.map((group) => (
              <button
                aria-label={`${group.emoji} ${group.count}${group.names.length ? `: ${group.names.join(", ")}` : ""}`}
                className={[
                  "inline-flex items-center gap-0.5 rounded-pill border bg-surface px-1.5 py-0.5 text-caption shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  group.mine ? "border-primary" : "border-border",
                ].join(" ")}
                disabled={!capabilities.canReact}
                key={group.emoji}
                onClick={() => onReact?.(message, group.emoji)}
                title={group.names.join(", ")}
                type="button"
              >
                <span>{group.emoji}</span>
                {group.count > 1 ? <span className="text-text-muted">{group.count}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {/* Menu de ações: aparece ao passar o mouse (sempre visível em telas de toque) */}
        {hasAnyAction ? (
          <div
            className={[
              "absolute top-1 z-10",
              isOutgoing ? "left-0 -translate-x-full pr-1" : "right-0 translate-x-full pl-1",
            ].join(" ")}
          >
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Ações da mensagem"
              className={[
                "relative flex size-8 items-center justify-center rounded-full bg-surface text-text-muted shadow ring-1 ring-border transition-opacity before:absolute before:-inset-[6px] before:content-[''] hover:text-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100",
              ].join(" ")}
              data-testid="message-menu-button"
              ref={menuButtonRef}
              onClick={() => {
                setPickerOpen(false);
                setMenuOpen((value) => !value);
              }}
              type="button"
            >
              <ChevronDown aria-hidden="true" size={16} />
            </button>
          </div>
        ) : null}

        {/* Desktop: menu e seletor de emoji em portal (FloatingMenu), sempre dentro da tela. Celular/tablet: folha de toque (BottomSheet). */}
          <FloatingMenu
            align={isOutgoing ? "end" : "start"}
            anchorRef={menuButtonRef}
            className="w-48 rounded-card border border-border bg-surface py-1 shadow-lg"
            data-testid="message-menu"
            open={menuOpen && !compact}
            role="menu"
          >
            {entries.map((entry) => (
              <div key={entry.key}>
                {entry.separatorBefore ? <div className="my-1 h-px bg-border" /> : null}
                <MenuItem danger={entry.danger} icon={entry.icon} label={entry.label} onClick={entry.onClick} testId={entry.testId} />
              </div>
            ))}
          </FloatingMenu>

          <FloatingMenu align={isOutgoing ? "end" : "start"} anchorRef={menuButtonRef} data-testid="message-emoji-picker" open={pickerOpen && !compact}>
            <EmojiPicker current={myReaction} onPick={pickEmoji} />
          </FloatingMenu>

          {/* No celular o menu e os emojis sobem da base da tela (toque; sem depender de passar o mouse) */}
          <BottomSheet
            onClose={() => {
              setMenuOpen(false);
              setPickerOpen(false);
            }}
            open={compact && (menuOpen || pickerOpen)}
            testId="message-sheet"
            title={pickerOpen ? "Reagir à mensagem" : "Mensagem"}
          >
            {pickerOpen ? (
              <div className="flex justify-center px-2 pb-2">
                <EmojiPicker current={myReaction} onPick={pickEmoji} />
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.key}>
                  {entry.separatorBefore ? <div className="my-1 h-px bg-border" /> : null}
                  <SheetItem danger={entry.danger} icon={entry.icon} label={entry.label} onClick={entry.onClick} testId={entry.testId} />
                </div>
              ))
            )}
          </BottomSheet>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  testId: string;
}) {
  return (
    <button
      className={[
        "flex min-h-10 w-full items-center gap-2 px-3 text-left text-body hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none",
        danger ? "text-danger" : "text-text",
      ].join(" ")}
      data-testid={testId}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}
