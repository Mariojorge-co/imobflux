"use client";

import { useState } from "react";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/quick-replies/confirm-dialog";
import type { ThreadNote } from "@/lib/conversations/message-actions";
import { formatRelativeTime } from "@/lib/date";

export type NoteViewer = { memberId: string; role: "owner" | "attendant" } | null;

/** Quem pode o quê: o AUTOR edita e apaga a própria nota; o dono apaga qualquer uma (o banco repete a regra). */
export function noteCapabilities(note: Pick<ThreadNote, "author_member_id">, viewer: NoteViewer) {
  const isAuthor = Boolean(viewer && viewer.memberId === note.author_member_id);
  return { canEdit: isAuthor, canDelete: isAuthor || viewer?.role === "owner" };
}

type InternalNoteCardProps = {
  note: ThreadNote;
  viewer: NoteViewer;
  onEdit: (noteId: string, content: string) => Promise<{ success: boolean; error?: string }>;
  onDelete: (noteId: string) => Promise<{ success: boolean; error?: string }>;
};

const actionButton =
  "inline-flex min-h-8 items-center gap-1 rounded-control border border-transparent px-2 text-caption font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:text-amber-200 dark:hover:bg-amber-500/20 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3";

/**
 * Cartão "Nota interna" do painel do cliente: texto, autor, hora e os botões ESCRITOS "Editar" e "Apagar" (apagar pede
 * confirmação). Nunca vai ao WhatsApp. É o mesmo comportamento da nota no meio da conversa.
 */
export function InternalNoteCard({ note, viewer, onEdit, onDelete }: InternalNoteCardProps) {
  const { canEdit, canDelete } = noteCapabilities(note, viewer);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const edited = new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 1000;

  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await onEdit(note.id, draft.trim());
    setBusy(false);
    if (result.success) setEditing(false);
    else setError(result.error ?? "Não foi possível salvar a nota.");
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await onDelete(note.id);
    setBusy(false);
    if (result.success) setConfirmOpen(false);
    else setError(result.error ?? "Não foi possível apagar a nota.");
  };

  return (
    <article className="rounded-control border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs" data-testid="context-note">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
          <Lock aria-hidden="true" size={12} /> Nota interna · não enviada ao cliente
        </span>
        <time className="shrink-0 text-caption text-text-muted">{formatRelativeTime(note.created_at)}</time>
      </div>

      {editing ? (
        <div className="space-y-1.5">
          <textarea
            aria-label="Editar nota interna"
            autoFocus
            className="min-h-20 w-full resize-y rounded-control border border-amber-400/60 bg-surface px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-amber-500"
            data-testid="context-note-input"
            maxLength={4096}
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
          <div className="flex justify-end gap-2">
            <button
              className={actionButton}
              onClick={() => {
                setEditing(false);
                setDraft(note.content);
                setError(null);
              }}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="inline-flex min-h-8 items-center rounded-control bg-amber-700 px-3 text-caption font-semibold text-white hover:bg-amber-800 disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
              data-testid="context-note-save"
              disabled={busy || !draft.trim()}
              onClick={() => void save()}
              type="button"
            >
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-text" data-testid="context-note-text">
          {note.content}
        </p>
      )}

      {error ? (
        <p className="mt-1 text-caption font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-caption font-medium text-text-muted">
          por {note.author_name}
          {edited ? <span className="ml-1 font-normal italic">· editada</span> : null}
        </p>
        {!editing && (canEdit || canDelete) ? (
          <div className="flex items-center gap-1">
            {canEdit ? (
              <button className={actionButton} data-testid="context-note-edit" onClick={() => setEditing(true)} type="button">
                <Pencil aria-hidden="true" size={13} /> Editar
              </button>
            ) : null}
            {canDelete ? (
              <button className={actionButton} data-testid="context-note-delete" onClick={() => setConfirmOpen(true)} type="button">
                <Trash2 aria-hidden="true" size={13} /> Apagar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        confirmLabel="Apagar nota"
        description="A nota interna some para toda a equipe. Ela nunca foi enviada ao cliente."
        destructive
        error={confirmOpen ? error : null}
        onCancel={() => {
          if (!busy) {
            setConfirmOpen(false);
            setError(null);
          }
        }}
        onConfirm={() => void remove()}
        open={confirmOpen}
        pending={busy}
        title="Apagar esta nota?"
      />
    </article>
  );
}
