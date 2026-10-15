"use client";

import { useState } from "react";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { splitForHighlight } from "@/lib/conversations/message-ui";
import type { ThreadNote } from "@/lib/conversations/message-actions";

type NoteBubbleProps = {
  note: ThreadNote;
  viewer: { memberId: string; role: "owner" | "attendant" } | null;
  highlight?: string;
  onEdit: (noteId: string, content: string) => Promise<{ success: boolean; error?: string }>;
  onDelete: (noteId: string) => Promise<{ success: boolean; error?: string }>;
};

/**
 * Nota interna no meio da conversa: fundo amarelo claro, cadeado e "Só a equipe vê". Nunca vai ao WhatsApp. O AUTOR edita e
 * apaga a própria nota; o dono apaga qualquer uma (o banco repete a regra).
 */
export function NoteBubble({ note, viewer, highlight, onEdit, onDelete }: NoteBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthor = Boolean(viewer && viewer.memberId === note.author_member_id);
  const canEdit = isAuthor;
  const canDelete = isAuthor || viewer?.role === "owner";
  const edited = note.updated_at > note.created_at && new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 1000;
  const time = new Date(note.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

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
    if (!window.confirm("Apagar esta nota interna? Ela some para toda a equipe.")) return;
    setBusy(true);
    setError(null);
    const result = await onDelete(note.id);
    setBusy(false);
    if (!result.success) setError(result.error ?? "Não foi possível apagar a nota.");
  };

  return (
    <div className="flex justify-center" data-testid="internal-note">
      <div className="w-full max-w-[92%] rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-amber-950 shadow-sm dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100 sm:max-w-[80%]">
        <p className="mb-0.5 flex flex-wrap items-center gap-x-1.5 text-caption font-semibold text-amber-800 dark:text-amber-300">
          <Lock aria-hidden="true" size={12} />
          <span>Nota interna</span>
          <span className="font-normal">· Só a equipe vê</span>
          <span className="font-normal">· {note.author_name}</span>
        </p>

        {editing ? (
          <div className="space-y-1.5">
            <textarea
              aria-label="Editar nota interna"
              autoFocus
              className="min-h-16 w-full resize-y rounded-control border border-amber-400/60 bg-white/70 px-2 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-black/20"
              maxLength={4096}
              onChange={(event) => setDraft(event.target.value)}
              value={draft}
            />
            <div className="flex justify-end gap-2">
              <button
                className="min-h-8 rounded-control px-3 text-caption font-medium text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-500/20"
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
                className="min-h-8 rounded-control bg-amber-600 px-3 text-caption font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                data-testid="note-save"
                disabled={busy || !draft.trim()}
                onClick={() => void save()}
                type="button"
              >
                {busy ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm" data-testid="note-text">
            {highlight
              ? splitForHighlight(note.content, highlight).map((part, index) =>
                  part.match ? (
                    <mark className="rounded-sm bg-warning-soft px-0.5 text-text" data-testid="search-mark" key={index}>
                      {part.text}
                    </mark>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )
              : note.content}
          </p>
        )}

        {error ? (
          <p className="mt-1 text-caption font-medium text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-1 flex items-center justify-end gap-2 text-caption text-amber-800/80 dark:text-amber-300/80">
          {edited ? <span className="italic">editada</span> : null}
          <span>{time}</span>
          {!editing && canEdit ? (
            <button
              aria-label="Editar nota"
              className="flex size-7 items-center justify-center rounded-control hover:bg-amber-100 dark:hover:bg-amber-500/20"
              data-testid="note-edit"
              onClick={() => setEditing(true)}
              type="button"
            >
              <Pencil aria-hidden="true" size={13} />
            </button>
          ) : null}
          {!editing && canDelete ? (
            <button
              aria-label="Apagar nota"
              className="flex size-7 items-center justify-center rounded-control hover:bg-amber-100 dark:hover:bg-amber-500/20"
              data-testid="note-delete"
              onClick={() => void remove()}
              type="button"
            >
              <Trash2 aria-hidden="true" size={13} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
