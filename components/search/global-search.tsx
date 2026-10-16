"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, Search, UserRound, Users } from "lucide-react";
import { Button, ModalDialog } from "@/components/ui";
import { searchGlobalAction, type GlobalSearchItem } from "@/lib/search/global";
import { GLOBAL_SEARCH_MIN, searchResultHref, splitHighlight } from "@/lib/search/highlight";
import { isEditableTarget } from "@/lib/ui/escape-stack";

function Highlighted({ text, term }: { text: string; term: string }) {
  return (
    <>
      {splitHighlight(text, term).map((part, index) =>
        part.match ? (
          <mark className="rounded-sm bg-warning-soft px-0.5 font-semibold text-text" data-testid="search-mark" key={index}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Maceio" });
}

type State = {
  term: string;
  items: GlobalSearchItem[];
  hasMore: boolean;
  total: number;
  loading: boolean;
  error: string | null;
};

const EMPTY: State = { term: "", items: [], hasMore: false, total: 0, loading: false, error: null };

/** Busca global (botão no topo ou tecla "/"): mensagens, legendas e contatos de todas as conversas que a pessoa enxerga. */
export function GlobalSearch() {
  const router = useRouter();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>(EMPTY);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== "/") return;
      if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Busca com atraso curto; cada digitação cancela a anterior (só a última resposta vale).
  useEffect(() => {
    const term = query.trim();
    if (term.length < GLOBAL_SEARCH_MIN) return;
    const id = ++requestRef.current;
    const timer = window.setTimeout(() => {
      setState((previous) => ({ ...previous, term, loading: true, error: null }));
      void searchGlobalAction(term, 0).then((result) => {
        if (id !== requestRef.current) return;
        if (!result.success) setState({ ...EMPTY, term, error: result.error });
        else setState({ term, items: result.items, hasMore: result.hasMore, total: result.total, loading: false, error: null });
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadMore = () => {
    const id = ++requestRef.current;
    const term = state.term;
    setState((previous) => ({ ...previous, loading: true }));
    void searchGlobalAction(term, state.items.length).then((result) => {
      if (id !== requestRef.current) return;
      if (!result.success) setState((previous) => ({ ...previous, loading: false, error: result.error }));
      else
        setState((previous) => ({
          ...previous,
          items: [...previous.items, ...result.items],
          hasMore: result.hasMore,
          total: result.total,
          loading: false,
        }));
    });
  };

  const close = () => {
    requestRef.current += 1;
    setOpen(false);
    setQuery("");
    setState(EMPTY);
  };

  const openItem = (item: GlobalSearchItem) => {
    const href = searchResultHref(item.conversation_id, item.message_id);
    close();
    router.push(href);
  };

  const moveFocus = (event: KeyboardEvent, direction: 1 | -1) => {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-result]") ?? []);
    if (buttons.length === 0) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current === -1 ? (direction === 1 ? 0 : buttons.length - 1) : current + direction;
    if (next < 0) inputRef.current?.focus();
    else buttons[Math.min(next, buttons.length - 1)].focus();
  };

  const searched = query.trim().length >= GLOBAL_SEARCH_MIN;

  return (
    <>
      <button
        aria-label="Buscar em todas as conversas"
        className="flex size-11 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:size-9"
        data-testid="global-search-button"
        onClick={() => setOpen(true)}
        title="Buscar em todas as conversas (/)"
        type="button"
      >
        <Search aria-hidden="true" size={18} />
      </button>
      <ModalDialog
        className="w-[min(calc(100%_-_1.5rem),40rem)]"
        labelledBy={titleId}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        open={open}
      >
        {open ? (
          <div className="space-y-3" data-testid="global-search">
            <h2 className="text-section-title font-semibold text-text" id={titleId}>
              Buscar em todas as conversas
            </h2>
            <input
              aria-label="Termo da busca"
              autoFocus
              className="min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-body text-text outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15"
              data-testid="global-search-input"
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") moveFocus(event, 1);
                else if (event.key === "Escape") {
                  // Em campo de busca o Esc limparia o texto primeiro; aqui fecha a busca de uma vez.
                  event.preventDefault();
                  close();
                }
              }}
              placeholder="Mensagem, legenda, nome ou telefone"
              ref={inputRef}
              type="search"
              value={query}
            />
            <p aria-live="polite" className="min-h-5 text-caption text-text-muted" data-testid="global-search-status">
              {state.error
                ? state.error
                : !searched
                  ? "Digite ao menos 2 letras."
                  : state.loading && state.items.length === 0
                    ? "Buscando…"
                    : state.items.length === 0
                      ? "Nenhum resultado."
                      : `${state.total >= 500 ? "Mais de 500" : state.total} ${state.total === 1 ? "resultado" : "resultados"}`}
            </p>
            {searched && state.items.length > 0 ? (
              <ul
                className="max-h-[55vh] divide-y divide-border overflow-y-auto rounded-control border border-border"
                data-testid="global-search-results"
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") moveFocus(event, 1);
                  else if (event.key === "ArrowUp") moveFocus(event, -1);
                }}
                ref={listRef}
              >
                {state.items.map((item, index) => {
                  const Icon = item.conversation_type === "group" ? Users : UserRound;
                  return (
                    <li key={`${item.conversation_id}-${item.message_id ?? "contato"}-${index}`}>
                      <button
                        className="flex min-h-11 w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                        data-kind={item.kind}
                        data-result
                        data-testid="global-search-result"
                        onClick={() => openItem(item)}
                        type="button"
                      >
                        <Icon aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" size={18} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-body font-semibold text-text">
                              <Highlighted term={state.term} text={item.participant_name || "Contato"} />
                            </span>
                            {item.archived ? <Archive aria-label="Conversa encerrada" className="shrink-0 text-text-muted" size={13} /> : null}
                            <span className="ml-auto shrink-0 text-caption text-text-muted">{formatWhen(item.occurred_at)}</span>
                          </span>
                          {item.snippet ? (
                            <span className="mt-0.5 line-clamp-3 block whitespace-pre-line break-words text-caption text-text-muted">
                              <Highlighted term={state.term} text={item.snippet} />
                            </span>
                          ) : (
                            <span className="mt-0.5 block truncate text-caption text-text-muted">
                              <Highlighted term={state.term} text={item.participant_phone ?? "Contato"} />
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <div className="flex justify-between gap-2">
              {state.hasMore ? (
                <Button data-testid="global-search-more" disabled={state.loading} onClick={loadMore} variant="secondary">
                  {state.loading ? "Carregando…" : "Mostrar mais"}
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={close} variant="primary">
                Fechar
              </Button>
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </>
  );
}
