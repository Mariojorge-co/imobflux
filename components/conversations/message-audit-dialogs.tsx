"use client";

import { useEffect, useId, useState } from "react";
import { Button, ModalDialog } from "@/components/ui";
import {
  getMessageHistoryAction,
  listHiddenMessagesAction,
  restoreHiddenMessageAction,
  type HiddenMessage,
  type MessageHistory,
} from "@/lib/conversations/message-actions";

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const sourceLabel = (source: string) => (source === "whatsapp" ? "pelo celular/WhatsApp" : "pelo ImobFlux");

/** Histórico de uma mensagem editada ou apagada para todos. Só o dono chega aqui (a RLS também só deixa o dono ler). */
export function MessageHistoryDialog({ messageId, onClose }: { messageId: string | null; onClose: () => void }) {
  const titleId = useId();
  return (
    <ModalDialog labelledBy={titleId} onOpenChange={(open) => !open && onClose()} open={messageId !== null}>
      {messageId ? <HistoryBody key={messageId} messageId={messageId} onClose={onClose} titleId={titleId} /> : null}
    </ModalDialog>
  );
}

function HistoryBody({ messageId, onClose, titleId }: { messageId: string; onClose: () => void; titleId: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; error: string } | { status: "ready"; history: MessageHistory }>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void getMessageHistoryAction(messageId).then((result) => {
      if (cancelled) return;
      setState(result.success ? { status: "ready", history: result.history } : { status: "error", error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  return (
    <div className="space-y-3" data-testid="message-history">
      <h2 className="text-section-title font-semibold text-text" id={titleId}>Histórico da mensagem</h2>
      {state.status === "loading" ? <p className="text-body text-text-muted">Carregando…</p> : null}
      {state.status === "error" ? <p className="rounded-control bg-danger-soft px-3 py-2 text-caption font-medium text-danger" role="alert">{state.error}</p> : null}
      {state.status === "ready" ? (
        <div className="space-y-3">
          {state.history.deletion ? (
            <section aria-label="Mensagem apagada">
              <p className="text-caption font-semibold text-text">
                Apagada para todos {sourceLabel(state.history.deletion.source)} em {when(state.history.deletion.deleted_at)}. Texto original:
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words rounded-control bg-neutral-soft px-3 py-2 text-body text-text" data-testid="history-original">
                {state.history.deletion.original_text ?? "(sem texto — era um arquivo)"}
              </p>
            </section>
          ) : null}
          {state.history.edits.length > 0 ? (
            <section aria-label="Edições">
              <p className="text-caption font-semibold text-text">Edições</p>
              <ol className="mt-1 space-y-2">
                {state.history.edits.map((edit, index) => (
                  <li className="rounded-control border border-border px-3 py-2" data-testid="history-edit" key={`${edit.edited_at}-${index}`}>
                    <p className="text-caption text-text-muted">{when(edit.edited_at)} · {sourceLabel(edit.source)}</p>
                    <p className="whitespace-pre-wrap break-words text-body text-text-muted line-through">{edit.previous_text}</p>
                    <p className="whitespace-pre-wrap break-words text-body text-text">{edit.new_text}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {!state.history.deletion && state.history.edits.length === 0 ? <p className="text-body text-text-muted">Esta mensagem não tem histórico.</p> : null}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={onClose} variant="secondary">Fechar</Button>
      </div>
    </div>
  );
}

/** Mensagens escondidas ("apagar para mim") da conversa: só o dono vê e restaura. */
export function HiddenMessagesDialog({
  conversationId,
  open,
  onClose,
  onRestored,
}: {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const titleId = useId();
  return (
    <ModalDialog labelledBy={titleId} onOpenChange={(next) => !next && onClose()} open={open}>
      {open ? <HiddenBody conversationId={conversationId} onClose={onClose} onRestored={onRestored} titleId={titleId} /> : null}
    </ModalDialog>
  );
}

function HiddenBody({ conversationId, onClose, onRestored, titleId }: { conversationId: string; onClose: () => void; onRestored: () => void; titleId: string }) {
  const [items, setItems] = useState<HiddenMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listHiddenMessagesAction(conversationId).then((result) => {
      if (cancelled) return;
      if (result.success) setItems(result.messages);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const restore = async (id: string) => {
    setBusyId(id);
    setError(null);
    const result = await restoreHiddenMessageAction(id);
    setBusyId(null);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setItems((current) => (current ? current.filter((item) => item.id !== id) : current));
    onRestored();
  };

  return (
    <div className="space-y-3" data-testid="hidden-messages">
      <h2 className="text-section-title font-semibold text-text" id={titleId}>Mensagens escondidas</h2>
      <p className="text-caption text-text-muted">Foram escondidas no ImobFlux para toda a equipe (continuam no WhatsApp). Só o dono restaura.</p>
      {error ? <p className="rounded-control bg-danger-soft px-3 py-2 text-caption font-medium text-danger" role="alert">{error}</p> : null}
      {items === null && !error ? <p className="text-body text-text-muted">Carregando…</p> : null}
      {items && items.length === 0 ? <p className="text-body text-text-muted">Nenhuma mensagem escondida nesta conversa.</p> : null}
      {items && items.length > 0 ? (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-control border border-border">
          {items.map((item) => (
            <li className="flex items-start justify-between gap-2 px-3 py-2" data-testid="hidden-item" key={item.id}>
              <div className="min-w-0">
                <p className="text-caption text-text-muted">{item.direction === "outgoing" ? "Equipe" : "Cliente"} · {when(item.occurred_at)}</p>
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-body text-text">{item.text ?? "(arquivo)"}</p>
              </div>
              <Button disabled={busyId === item.id} onClick={() => void restore(item.id)} variant="secondary">
                {busyId === item.id ? "Restaurando…" : "Restaurar"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={onClose} variant="secondary">Fechar</Button>
      </div>
    </div>
  );
}
