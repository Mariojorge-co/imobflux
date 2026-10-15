"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Button, Input, ModalDialog } from "@/components/ui";
import { saveQuickReplyCategoryAction } from "@/lib/quick-replies/actions";
import { QUICK_REPLY_CATEGORY_MAX, type QuickReplyCategory } from "@/lib/quick-replies/types";

type CategoryFormDialogProps = {
  open: boolean;
  /** Categoria em edição; nula para criar. */
  category: QuickReplyCategory | null;
  onClose: () => void;
  onSaved: (category: { id: string; name: string }) => void;
};

export function CategoryFormDialog(props: CategoryFormDialogProps) {
  const titleId = useId();
  return (
    <ModalDialog
      labelledBy={titleId}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      open={props.open}
    >
      {props.open ? <CategoryForm key={props.category?.id ?? "nova"} {...props} titleId={titleId} /> : null}
    </ModalDialog>
  );
}

function CategoryForm({ category, onClose, onSaved, titleId }: CategoryFormDialogProps & { titleId: string }) {
  const inputId = useId();
  const [name, setName] = useState(category?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await saveQuickReplyCategoryAction(category?.id ?? null, name);
      if (result.success) onSaved({ id: result.id, name: result.name });
      else setError(result.error);
    });
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <h2 className="text-body font-semibold text-text" id={titleId}>
        {category ? "Editar categoria" : "Nova categoria"}
      </h2>
      <div className="space-y-1">
        <label className="text-caption font-medium text-text" htmlFor={inputId}>
          Nome da categoria
        </label>
        <Input
          autoFocus
          id={inputId}
          maxLength={QUICK_REPLY_CATEGORY_MAX}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: 🏠 Visitas"
          value={name}
        />
        <p className="text-caption text-text-muted">Até {QUICK_REPLY_CATEGORY_MAX} caracteres; pode começar com um emoji.</p>
      </div>
      {error ? (
        <p className="rounded-control bg-danger-soft px-3 py-2 text-caption font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} variant="secondary">
          Cancelar
        </Button>
        <Button disabled={name.trim() === "" || isPending} type="submit">
          {isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
