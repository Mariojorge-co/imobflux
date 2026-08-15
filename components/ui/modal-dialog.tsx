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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={labelledBy}
      className={classNames(
        "m-auto w-[min(calc(100%_-_2rem),28rem)] rounded-card border border-border bg-surface p-card text-text shadow-xl backdrop:bg-text/35",
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
