"use client";

import { useId, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { Paperclip, X } from "lucide-react";
import { Button, Input, ModalDialog, Select } from "@/components/ui";
import { HighlightedText } from "@/components/quick-replies/highlighted-text";
import { saveQuickReplyAction } from "@/lib/quick-replies/actions";
import { removeQuickReplyAttachmentAction } from "@/lib/quick-replies/attachment-actions";
import { checkQuickReplyFile, uploadQuickReplyAttachment } from "@/lib/quick-replies/attachment-client";
import { ACCEPT_ATTRIBUTE, formatFileSize } from "@/lib/conversations/outgoing-files";
import { insertAtCursor } from "@/lib/quick-replies/insert";
import {
  QUICK_REPLY_ATTACHMENT_MAX,
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
  // Arquivos: os que já estão na resposta (podem ser marcados para remover) e os novos (sobem ao salvar).
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(reply?.id ?? null);
  const keptAttachments = (reply?.attachments ?? []).filter((attachment) => !removedIds.includes(attachment.id));
  const attachmentCount = keptAttachments.length + newFiles.length;

  const handleFilesChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    const room = Math.max(0, QUICK_REPLY_ATTACHMENT_MAX - attachmentCount);
    const notices: string[] = [];
    const accepted: File[] = [];
    for (const file of chosen.slice(0, room)) {
      const problem = await checkQuickReplyFile(file);
      if (problem) notices.push(problem);
      else accepted.push(file);
    }
    if (chosen.length > room) notices.push(`Cada resposta aceita até ${QUICK_REPLY_ATTACHMENT_MAX} arquivos.`);
    setFileNotice(notices.length > 0 ? notices.join(" ") : null);
    if (accepted.length > 0) setNewFiles((previous) => [...previous, ...accepted]);
  };

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
        id: savedId,
        title,
        body,
        categoryId: categoryId || null,
        isActive,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      // A resposta já existe: a partir daqui, salvar de novo edita esta mesma (não cria outra).
      setSavedId(result.id);
      const problems: string[] = [];
      for (const attachmentId of removedIds) {
        const removed = await removeQuickReplyAttachmentAction(attachmentId);
        if (!removed.success) problems.push(removed.error);
      }
      const stillPending: File[] = [];
      for (const file of newFiles) {
        const uploaded = await uploadQuickReplyAttachment(result.id, file);
        if (!uploaded.success) {
          problems.push(`${file.name}: ${uploaded.error}`);
          stillPending.push(file);
        }
      }
      if (problems.length > 0) {
        // O texto foi salvo; os arquivos que falharam continuam na lista para tentar de novo.
        setRemovedIds([]);
        setNewFiles(stillPending);
        setError(`A resposta foi salva, mas houve problema com os arquivos. ${problems.join(" ")}`);
        return;
      }
      onSaved();
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

      <div className="space-y-1.5" data-testid="quick-reply-attachments">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption font-medium text-text">
            Arquivos anexados ({attachmentCount} de {QUICK_REPLY_ATTACHMENT_MAX})
          </span>
          <label
            className={[
              "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-control border border-border-strong bg-surface px-3 text-caption font-medium text-text hover:bg-neutral-soft focus-within:ring-2 focus-within:ring-primary",
              attachmentCount >= QUICK_REPLY_ATTACHMENT_MAX ? "pointer-events-none opacity-50" : "",
            ].join(" ")}
          >
            <Paperclip aria-hidden="true" size={14} />
            Adicionar arquivos
            <input
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              data-testid="quick-reply-file-input"
              disabled={attachmentCount >= QUICK_REPLY_ATTACHMENT_MAX}
              multiple
              onChange={(event) => void handleFilesChosen(event)}
              type="file"
            />
          </label>
        </div>
        <p className="text-caption text-text-muted">
          Até {QUICK_REPLY_ATTACHMENT_MAX} arquivos de 25 MB. Ao usar a resposta, eles entram na caixa de envio da conversa e só saem quando você enviar.
        </p>
        {fileNotice ? (
          <p className="text-caption font-medium text-danger" role="status">
            {fileNotice}
          </p>
        ) : null}
        {attachmentCount > 0 ? (
          <ul className="divide-y divide-border rounded-control border border-border">
            {keptAttachments.map((attachment) => (
              <li className="flex min-h-11 items-center gap-2 px-2.5 py-1.5" data-testid="quick-reply-attachment" key={attachment.id}>
                <Paperclip aria-hidden="true" className="shrink-0 text-text-muted" size={14} />
                <span className="min-w-0 flex-1 truncate text-body text-text">{attachment.file_name}</span>
                <span className="shrink-0 text-caption text-text-muted">{formatFileSize(attachment.size_bytes)}</span>
                <button
                  aria-label={`Remover ${attachment.file_name}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => setRemovedIds((previous) => [...previous, attachment.id])}
                  type="button"
                >
                  <X aria-hidden="true" size={16} />
                </button>
              </li>
            ))}
            {newFiles.map((file, index) => (
              <li className="flex min-h-11 items-center gap-2 px-2.5 py-1.5" data-testid="quick-reply-attachment-new" key={`${file.name}-${index}`}>
                <Paperclip aria-hidden="true" className="shrink-0 text-primary" size={14} />
                <span className="min-w-0 flex-1 truncate text-body text-text">{file.name}</span>
                <span className="shrink-0 text-caption text-text-muted">{formatFileSize(file.size)} · novo</span>
                <button
                  aria-label={`Remover ${file.name}`}
                  className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => setNewFiles((previous) => previous.filter((_, position) => position !== index))}
                  type="button"
                >
                  <X aria-hidden="true" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

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
