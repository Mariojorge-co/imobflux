"use client";

import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

type ViewportMenuProps = {
  anchorRef: RefObject<HTMLElement | null>;
  labelledBy: string;
  onClose: () => void;
  open: boolean;
  children: ReactNode;
};

type MenuPosition = {
  left: number;
  top: number;
  visibility: "hidden" | "visible";
};

const VIEWPORT_GUTTER = 8;
const MENU_GAP = 4;

export function ViewportMenu({
  anchorRef,
  children,
  labelledBy,
  onClose,
  open,
}: ViewportMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition>({
    left: 0,
    top: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const menu = menuRef.current;
      if (!anchor || !menu) return;

      const anchorRect = anchor.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const availableBelow = window.innerHeight - anchorRect.bottom - VIEWPORT_GUTTER;
      const availableAbove = anchorRect.top - VIEWPORT_GUTTER;
      const opensUpward = availableBelow < menuRect.height && availableAbove > availableBelow;
      const top = opensUpward
        ? Math.max(VIEWPORT_GUTTER, anchorRect.top - menuRect.height - MENU_GAP)
        : Math.min(
            anchorRect.bottom + MENU_GAP,
            Math.max(VIEWPORT_GUTTER, window.innerHeight - menuRect.height - VIEWPORT_GUTTER),
          );
      const left = Math.min(
        Math.max(VIEWPORT_GUTTER, anchorRect.right - menuRect.width),
        Math.max(VIEWPORT_GUTTER, window.innerWidth - menuRect.width - VIEWPORT_GUTTER),
      );

      setPosition({ left, top, visibility: "visible" });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    updatePosition();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-labelledby={labelledBy}
      className="fixed z-[70] max-h-[calc(100vh-1rem)] min-w-44 overflow-y-auto rounded-card border border-border bg-surface py-1 text-body shadow-lg ring-1 ring-black/5"
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top, visibility: position.visibility }}
    >
      {children}
    </div>,
    document.body,
  );
}
