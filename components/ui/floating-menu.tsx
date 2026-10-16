"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { classNames } from "@/lib/class-names";
import { placeFloating, type FloatingPlacement } from "@/lib/ui/floating-position";

type FloatingMenuProps = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
  role?: string;
};

/** Menu em portal (fora de qualquer área com rolagem ou corte), posicionado com `placeFloating`. */
export function FloatingMenu({ anchorRef, open, align = "start", className, children, role, ...rest }: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const rect = anchor.getBoundingClientRect();
    // Mede o tamanho natural (sem limite de altura) para decidir se cabe.
    const previous = menu.style.maxHeight;
    menu.style.maxHeight = "none";
    const size = { width: menu.offsetWidth, height: menu.scrollHeight };
    menu.style.maxHeight = previous;
    setPlacement(placeFloating(rect, size, { width: window.innerWidth, height: window.innerHeight }, align));
  }, [align, anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure, children]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [open, measure]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className={classNames("fixed z-50 overflow-y-auto", className)}
      data-floating-menu=""
      ref={menuRef}
      role={role}
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        maxHeight: placement?.maxHeight,
        // Antes da primeira medição o menu fica invisível (evita um "pulo" na tela).
        visibility: placement ? "visible" : "hidden",
      }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
