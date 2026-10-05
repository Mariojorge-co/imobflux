"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { classNames } from "@/lib/class-names";

type ModalDialogProps = {
  children: ReactNode;
  className?: string;
  labelledBy: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function ModalDialog({
  children,
  className,
  labelledBy,
  onOpenChange,
  open,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pointerStartedInsideRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      previousFocusRef.current?.focus();
    }
  }, [open]);

  return (
    <dialog
      aria-labelledby={labelledBy}
      className={classNames(
        "m-auto w-[min(calc(100%_-_2rem),28rem)] rounded-card border border-border bg-surface p-card text-text shadow-xl backdrop:bg-text/35 backdrop:backdrop-blur-xs",
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onPointerDown={(event) => {
        pointerStartedInsideRef.current = event.target !== event.currentTarget;
      }}
      onClick={(event) => {
        if (
          event.target === event.currentTarget &&
          !pointerStartedInsideRef.current
        ) {
          onOpenChange(false);
        }
        pointerStartedInsideRef.current = false;
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
