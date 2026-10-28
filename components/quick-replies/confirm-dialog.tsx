"use client";

import { useId } from "react";
import { Button, ModalDialog } from "@/components/ui";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Texto de erro da última tentativa, se houver. */
  error?: string | null;
  pending?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirmação curta: Cancelar fica em primeiro e recebe o foco ao abrir (a ação perigosa nunca é a padrão). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  error,
  pending,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  return (
    <ModalDialog
      labelledBy={titleId}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      open={open}
    >
      {open ? (
        <div className="space-y-3" role="alertdialog" aria-describedby={`${titleId}-desc`} aria-labelledby={titleId}>
          <h2 className="text-body font-semibold text-text" id={titleId}>
            {title}
          </h2>
          <p className="text-body text-text-muted" id={`${titleId}-desc`}>
            {description}
          </p>
          {error ? (
            <p className="rounded-control bg-danger-soft px-3 py-2 text-caption font-medium text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-4">
            <Button autoFocus className="min-h-11" onClick={onCancel} variant="secondary">
              {cancelLabel}
            </Button>
            <Button className="min-h-11" disabled={pending} onClick={onConfirm} variant={destructive ? "danger" : "primary"}>
              {pending ? "Aguarde…" : confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </ModalDialog>
  );
}
