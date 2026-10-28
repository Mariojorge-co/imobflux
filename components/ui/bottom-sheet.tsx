"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { captureFocusTarget } from "@/lib/ui/focus-return";
import { ESCAPE_PRIORITY, useEscapeLayer } from "@/lib/ui/escape-stack";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
};

/**
 * Folha que sobe da base da tela (menus no celular: toque, sem depender de passar o mouse). Fecha com Esc, tocando fora e no
 * botão. Os itens têm pelo menos 48px de altura (área de toque). Não é um <dialog> nativo: o Esc dela entra na pilha de camadas.
 */
export function BottomSheet({ open, onClose, title, children, testId = "bottom-sheet" }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEscapeLayer(open, ESCAPE_PRIORITY.messageMenu, () => {
    onClose();
  });

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = captureFocusTarget();
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus());
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  // Arrastar a alça/título para baixo fecha a folha (passou de ~80px) ou ela volta ao lugar.
  const startDrag = (event: ReactPointerEvent) => {
    dragStartRef.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent) => {
    if (dragStartRef.current === null) return;
    setDragY(Math.max(0, event.clientY - dragStartRef.current));
  };
  const endDrag = (event: ReactPointerEvent) => {
    if (dragStartRef.current === null) return;
    const distance = event.clientY - dragStartRef.current;
    dragStartRef.current = null;
    setDragY(0);
    if (distance > 80) onClose();
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    // Os eventos de ponteiro NÃO sobem pelo portal até quem abriu a folha (ex.: o toque prolongado da bolha).
    <div
      className="fixed inset-0 z-[80] flex items-end"
      data-bottom-sheet="true"
      data-testid={testId}
      onPointerCancel={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerLeave={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <button aria-label="Fechar" className="absolute inset-0 bg-text/40" onClick={onClose} tabIndex={-1} type="button" />
      <div
        aria-label={title}
        aria-modal="true"
        className="relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
        ref={panelRef}
        role="dialog"
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        <div
          className="touch-none"
          data-testid="sheet-handle"
          onPointerCancel={endDrag}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
        >
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong" />
          <p className="px-4 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-text-muted">{title}</p>
        </div>
        <div className="pb-1" role="menu">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Item de um BottomSheet: 48px de altura. */
export function SheetItem({
  icon,
  label,
  onClick,
  danger,
  testId,
  active,
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  testId?: string;
  active?: boolean;
}) {
  return (
    <button
      aria-checked={active}
      className={[
        "flex min-h-12 w-full items-center gap-3 px-4 text-left text-body hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none",
        danger ? "text-danger" : "text-text",
      ].join(" ")}
      data-testid={testId}
      onClick={onClick}
      role={active === undefined ? "menuitem" : "menuitemcheckbox"}
      type="button"
    >
      {icon ? <span aria-hidden="true" className="shrink-0">{icon}</span> : null}
      {label}
    </button>
  );
}
