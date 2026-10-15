"use client";

import { useId, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { ViewportMenu } from "@/components/ui";

type ItemMenuProps = {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
};

/** Menu "⋯" com Editar e Apagar. Só é desenhado para quem tem permissão (quem chama decide). */
export function ItemMenu({ label, onEdit, onDelete }: ItemMenuProps) {
  const buttonId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const itemClass =
    "flex min-h-11 w-full items-center gap-2 px-3 text-left text-body text-text hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none";

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Ações de ${label}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        id={buttonId}
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      <ViewportMenu anchorRef={anchorRef} labelledBy={buttonId} onClose={() => setOpen(false)} open={open}>
        <button
          className={itemClass}
          onClick={() => {
            setOpen(false);
            onEdit();
          }}
          role="menuitem"
          type="button"
        >
          <Pencil aria-hidden="true" size={15} /> Editar
        </button>
        <button
          className={`${itemClass} text-danger`}
          onClick={() => {
            setOpen(false);
            onDelete();
          }}
          role="menuitem"
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} /> Apagar
        </button>
      </ViewportMenu>
    </>
  );
}
