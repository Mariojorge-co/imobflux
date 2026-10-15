"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Button, Input, ModalDialog, Select } from "@/components/ui";
import { HighlightedText } from "@/components/quick-replies/highlighted-text";
import { saveQuickReplyAction } from "@/lib/quick-replies/actions";
import { insertAtCursor } from "@/lib/quick-replies/insert";
import {
  QUICK_REPLY_BODY_MAX,
  QUICK_REPLY_TITLE_MAX,
  type QuickReply,
  type QuickReplyCategory,
} from "@/lib/quick-replies/types";
import { PREVIEW_CONTEXT, QUICK_REPLY_VARIABLES, resolveVariables } from "@/lib/quick-replies/variables";

type QuickReplyFormDialogProps = {
  open: boolean;
  /** Resposta em edição; nula para criar uma nova. */
  reply: QuickReply | null;
  categories: QuickReplyCategory[];
  /** Categoria pré-selecionada ao criar. */
  defaultCategoryId?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function QuickReplyFormDialog(props: QuickReplyFormDialogProps) {
  const titleId = useId();
  return (
    <ModalDialog
      className="w-[min(calc(100%_-_1.5rem),40rem)]"
      labelledBy={titleId}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      open={props.open}
    >
      {props.open ? <QuickReplyForm key={props.reply?.id ?? "nova"} {...props} titleId={titleId} /> : null}
    </ModalDialog>
  );
}

function QuickReplyForm({
  reply,
  categories,
  defaultCategoryId,
  onClose,
  onSaved,
  titleId,
}: QuickReplyFormDialogProps & { titleId: string }) {
  const fieldId = useId();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState(reply?.title ?? "");
  const [body, setBody] = useState(reply?.body ?? "");
  const [categoryId, setCategoryId] = useState<string>(reply?.category_id ?? defaultCategoryId ?? "");
  const [isActive, setIsActive] = useState(reply?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const insertVariable = (token: string) => {
    const element = bodyRef.current;
    const result = insertAtCursor(body, element?.selectionStart, element?.selectionEnd, token, QUICK_REPLY_BODY_MAX);
    if (!result) return;
    setBody(result.value);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(result.caret, result.caret);
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await saveQuickReplyAction({
        id: reply?.id ?? null,
        title,
        body,
        categoryId: categoryId || null,
        isActive,
      });
      if (result.success) onSaved();
      else setError(result.error);
    });
  };

  const bodyTooLong = body.length > QUICK_REPLY_BODY_MAX;
  const canSave = title.trim() !== "" && body.trim() !== "" && !bodyTooLong && !isPending;

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <h2 className="text-body font-semibold text-text" id={titleId}>
        {reply ? "Editar resposta rápida" : "Nova resposta rápida"}
      </h2>

      <div className="space-y-1">
        <label className="text-caption font-medium text-text" htmlFor={`${fieldId}-title`}>
          Título
        </label>
        <Input
          autoFocus
          id={`${fieldId}-title`}
          maxLength={QUICK_REPLY_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Ex.: Confirmar visita"
          value={title}
        />
      </div>

      <div className="space-y-1">
        <label className="text-caption font-medium text-text" htmlFor={`${fieldId}-category`}>
          Categoria
        </label>
        <Select id={`${fieldId}-category`} onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
          <option value="">Sem categoria</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <div className="flex items-end justify-between gap-2">
          <label className="text-caption font-medium text-text" htmlFor={`${fieldId}-body`}>
            Texto da mensagem
          </label>
          <span className={["text-caption", bodyTooLong ? "font-bold text-danger" : "text-text-muted"].join(" ")}>
            {body.length} / {QUICK_REPLY_BODY_MAX}
          </span>
        </div>
        <textarea
          aria-describedby={`${fieldId}-help`}
          aria-invalid={bodyTooLong}
          className="min-h-48 w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
          id={`${fieldId}-body`}
          onChange={(event) => setBody(event.target.value)}
          placeholder={"Escreva a mensagem. Use *negrito*, _itálico_, emojis e quebras de linha como no WhatsApp."}
          ref={bodyRef}
          rows={8}
          value={body}
        />
        <p className="text-caption text-text-muted" id={`${fieldId}-help`}>
          O texto é guardado exatamente como você escreve. Variáveis:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_REPLY_VARIABLES.map((variable) => (
            <button
              className="min-h-9 rounded-control border border-border-strong bg-surface px-2 text-caption text-text hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              key={variable.key}
              onClick={() => insertVariable(variable.token)}
              title={variable.label}
              type="button"
            >
              {variable.token}
            </button>
          ))}
        </div>
      </div>

      {body.trim() ? (
        <div className="rounded-control border border-border bg-neutral-soft p-2.5">
          <p className="mb-1 text-caption font-medium text-text-muted">Pré-visualização (com dados de exemplo)</p>
          <div className="max-h-48 overflow-y-auto text-body text-text" data-testid="quick-reply-preview">
            <HighlightedText text={resolveVariables(body, PREVIEW_CONTEXT)} />
          </div>
        </div>
      ) : null}

      <label className="flex min-h-11 items-center gap-2 text-body text-text">
        <input
          checked={isActive}
          className="size-4 accent-primary"
          onChange={(event) => setIsActive(event.target.checked)}
          type="checkbox"
        />
        Ativa (aparece no painel e no atalho “/”)
      </label>

      {error ? (
        <p className="rounded-control bg-danger-soft px-3 py-2 text-caption font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button onClick={onClose} variant="secondary">
          Cancelar
        </Button>
        <Button disabled={!canSave} type="submit">
          {isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
