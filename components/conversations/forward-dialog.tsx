"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Search, TriangleAlert, X } from "lucide-react";
import { Button, ModalDialog } from "@/components/ui";
import { searchConversationsAction } from "@/lib/conversations/actions";
import { forwardMessageToConversationAction } from "@/lib/conversations/media-send";
import { queueFor } from "@/lib/conversations/send-queue";
import { FORWARD_MAX_TARGETS } from "@/lib/conversations/message-ui";
import type { ConversationListItem, ConversationMessage } from "@/lib/conversations/data";

type Target = { id: string; name: string };
type Outcome = { target: Target; ok: boolean; error?: string };

type ForwardDialogProps = {
  /** Mensagem a encaminhar; fechado quando nulo. */
  message: ConversationMessage | null;
  currentConversationId: string;
  onClose: () => void;
};

/**
 * Encaminhar: escolher uma ou várias conversas individuais (busca por nome ou telefone, no máximo 5), confirmar com a
 * quantidade e enviar. Cada destino entra na fila da SUA conversa e é independente: a falha de um não cancela os outros.
 */
export function ForwardDialog({ message, currentConversationId, onClose }: ForwardDialogProps) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  return (
    <ModalDialog
      className="w-[min(calc(100%_-_2rem),32rem)]"
      labelledBy={titleId}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      open={message !== null}
    >
      {/* O corpo é remontado a cada mensagem (key): o estado do diálogo sempre começa limpo. */}
      {message ? (
        <ForwardBody currentConversationId={currentConversationId} key={message.id} message={message} onBusyChange={setBusy} onClose={onClose} titleId={titleId} />
      ) : null}
    </ModalDialog>
  );
}

function ForwardBody({
  message,
  currentConversationId,
  onClose,
  onBusyChange,
  titleId,
}: {
  message: ConversationMessage;
  currentConversationId: string;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  titleId: string;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Target[]>([]);
  const [step, setStep] = useState<"choose" | "confirm" | "sending" | "done">("choose");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const requestRef = useRef(0);

  // Busca (com pequena espera ao digitar); sem texto mostra as conversas mais recentes.
  useEffect(() => {
    if (step !== "choose") return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      searchConversationsAction(search.trim(), undefined, "all")
        .then((items) => {
          if (request === requestRef.current) setResults(items);
        })
        .catch(() => {
          if (request === requestRef.current) setResults([]);
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search, step]);

  const candidates = results.filter(
    (item) => item.conversation_type === "individual" && item.conversation_id !== currentConversationId,
  );
  const isSelected = (id: string) => selected.some((target) => target.id === id);
  const atLimit = selected.length >= FORWARD_MAX_TARGETS;

  const toggle = (item: ConversationListItem) => {
    const id = item.conversation_id;
    setSelected((current) => {
      if (current.some((target) => target.id === id)) return current.filter((target) => target.id !== id);
      if (current.length >= FORWARD_MAX_TARGETS) return current;
      return [...current, { id, name: item.participant_name ?? "Contato" }];
    });
  };

  const send = async () => {
    if (selected.length === 0) return;
    setStep("sending");
    onBusyChange(true);
    const targets = selected;
    // Cada destino na fila da própria conversa (ordem preservada; um erro não trava os outros).
    const settled = await Promise.all(
      targets.map(
        (target) =>
          new Promise<Outcome>((resolve) => {
            void queueFor(target.id).enqueue(async () => {
              try {
                const result = await forwardMessageToConversationAction({
                  sourceMessageId: message.id,
                  targetConversationId: target.id,
                  idempotencyKey: crypto.randomUUID(),
                });
                resolve(result.success ? { target, ok: true } : { target, ok: false, error: result.error });
              } catch {
                resolve({ target, ok: false, error: "Erro de conexão. Verifique a internet e tente de novo." });
              }
            });
          }),
      ),
    );
    setOutcomes(settled);
    setStep("done");
    onBusyChange(false);
  };

  const failed = outcomes.filter((outcome) => !outcome.ok);

  return (
    <>
      {true ? (
        <div className="space-y-3" data-testid="forward-dialog">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-section-title font-semibold text-text" id={titleId}>
              {step === "confirm" ? "Confirmar encaminhamento" : step === "done" ? "Encaminhamento" : "Encaminhar mensagem"}
            </h2>
            <button
              aria-label="Fechar"
              className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft disabled:opacity-40"
              disabled={step === "sending"}
              onClick={onClose}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>

          <p className="line-clamp-2 rounded-control bg-neutral-soft px-3 py-2 text-caption text-text-muted" data-testid="forward-preview">
            {message.text_content?.trim() || (message.has_attachments ? "📎 Arquivo" : "Mensagem")}
          </p>

          {step === "choose" ? (
            <>
              <label className="relative block">
                <span className="sr-only">Buscar conversa por nome ou telefone</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
                <input
                  autoFocus
                  className="min-h-11 w-full rounded-control border border-border bg-background pl-9 pr-3 text-body text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  data-testid="forward-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por nome ou telefone"
                  value={search}
                />
              </label>

              {selected.length > 0 ? (
                <ul aria-label="Conversas escolhidas" className="flex flex-wrap gap-1.5" data-testid="forward-selected">
                  {selected.map((target) => (
                    <li className="inline-flex items-center gap-1 rounded-pill bg-primary/10 py-0.5 pl-2.5 pr-1 text-caption font-medium text-primary" key={target.id}>
                      {target.name}
                      <button
                        aria-label={`Tirar ${target.name}`}
                        className="flex size-5 items-center justify-center rounded-full hover:bg-primary/20"
                        onClick={() => setSelected((current) => current.filter((item) => item.id !== target.id))}
                        type="button"
                      >
                        <X aria-hidden="true" size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <ul aria-label="Conversas" className="max-h-64 divide-y divide-border overflow-y-auto rounded-control border border-border" data-testid="forward-results">
                {candidates.map((item) => {
                  const chosen = isSelected(item.conversation_id);
                  const blocked = !chosen && atLimit;
                  return (
                    <li key={item.conversation_id}>
                      <button
                        aria-pressed={chosen}
                        className="flex min-h-12 w-full items-center gap-2 px-3 text-left hover:bg-neutral-soft disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid="forward-option"
                        disabled={blocked}
                        onClick={() => toggle(item)}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className={["flex size-5 shrink-0 items-center justify-center rounded border", chosen ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"].join(" ")}
                        >
                          {chosen ? <Check size={13} /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-body font-medium text-text">{item.participant_name ?? "Contato"}</span>
                          {item.participant_phone ? <span className="block truncate text-caption text-text-muted">{item.participant_phone}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {candidates.length === 0 ? (
                  <li className="px-3 py-4 text-center text-caption text-text-muted">{loading ? "Buscando…" : "Nenhuma conversa encontrada."}</li>
                ) : null}
              </ul>

              <p className="text-caption text-text-muted">
                Até {FORWARD_MAX_TARGETS} conversas por vez. Só conversas individuais. {selected.length}/{FORWARD_MAX_TARGETS} escolhidas.
              </p>

              <div className="flex justify-end gap-2">
                <Button onClick={onClose} variant="secondary">Cancelar</Button>
                <Button data-testid="forward-continue" disabled={selected.length === 0} onClick={() => setStep("confirm")} variant="primary">
                  Continuar
                </Button>
              </div>
            </>
          ) : null}

          {step === "confirm" ? (
            <>
              <p className="text-body text-text" data-testid="forward-confirm-text">
                Encaminhar esta mensagem para <strong>{selected.length}</strong> {selected.length === 1 ? "conversa" : "conversas"}?
              </p>
              <ul className="list-inside list-disc text-caption text-text-muted">
                {selected.map((target) => (
                  <li key={target.id}>{target.name}</li>
                ))}
              </ul>
              {selected.length > 1 ? (
                <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-caption text-warning" data-testid="forward-risk-warning">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
                  Enviar a mesma mensagem para várias pessoas de uma vez pode fazer o WhatsApp bloquear o número. Encaminhe só para quem precisa.
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setStep("choose")} variant="secondary">Voltar</Button>
                <Button data-testid="forward-confirm" onClick={() => void send()} variant="primary">
                  Encaminhar para {selected.length}
                </Button>
              </div>
            </>
          ) : null}

          {step === "sending" ? (
            <p aria-live="polite" className="py-4 text-center text-body text-text-muted" role="status">
              Encaminhando…
            </p>
          ) : null}

          {step === "done" ? (
            <>
              <p className="text-body text-text" data-testid="forward-result" role="status">
                {failed.length === 0
                  ? `Mensagem encaminhada para ${outcomes.length} ${outcomes.length === 1 ? "conversa" : "conversas"}.`
                  : `Encaminhada para ${outcomes.length - failed.length} de ${outcomes.length}. ${failed.length === 1 ? "Uma falhou" : `${failed.length} falharam`}:`}
              </p>
              {failed.length > 0 ? (
                <ul className="space-y-1 text-caption text-danger" data-testid="forward-failures">
                  {failed.map((outcome) => (
                    <li key={outcome.target.id}>
                      <strong>{outcome.target.name}:</strong> {outcome.error}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex justify-end">
                <Button onClick={onClose} variant="primary">Fechar</Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
