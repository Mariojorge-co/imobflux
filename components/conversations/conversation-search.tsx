"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

type ConversationSearchProps = {
  query: string;
  onQueryChange: (value: string) => void;
  /** Total de resultados na conversa inteira (inclui mensagens ainda não carregadas). */
  total: number;
  /** Posição do resultado atual, começando em 0 (0 = o mais recente); -1 quando não há. */
  index: number;
  loading: boolean;
  /** Procurando uma mensagem antiga: carregando o histórico até chegar nela. */
  seeking: boolean;
  error: string | null;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
};

/** Barra de busca dentro da conversa (lupa no cabeçalho): contagem, setas e fechar. Enter vai ao resultado mais antigo. */
export function ConversationSearch({
  query,
  onQueryChange,
  total,
  index,
  loading,
  seeking,
  error,
  onOlder,
  onNewer,
  onClose,
}: ConversationSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const searched = query.trim().length >= 2;
  const status = error
    ? error
    : !searched
      ? "Digite ao menos 2 letras"
      : loading
        ? "Buscando…"
        : total === 0
          ? "Nenhum resultado"
          : seeking
            ? "Carregando mensagens antigas…"
            : `${index + 1} de ${total}`;

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3 py-1.5 sm:px-4" data-testid="conversation-search" role="search">
      <label className="sr-only" htmlFor="conversation-search-input">Buscar nesta conversa</label>
      <input
        autoComplete="off"
        className="min-h-9 min-w-0 flex-1 rounded-control border border-border bg-background px-3 text-body text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        data-testid="conversation-search-input"
        id="conversation-search-input"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onNewer();
            else onOlder();
          }
        }}
        placeholder="Buscar nesta conversa"
        ref={inputRef}
        type="search"
        value={query}
      />
      <span aria-live="polite" className="min-w-[7.5rem] text-right text-caption text-text-muted" data-testid="conversation-search-count" role="status">
        {status}
      </span>
      <button
        aria-label="Resultado mais antigo"
        className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text disabled:opacity-40"
        data-testid="search-older"
        disabled={total === 0 || index >= total - 1}
        onClick={onOlder}
        type="button"
      >
        <ChevronUp aria-hidden="true" size={18} />
      </button>
      <button
        aria-label="Resultado mais recente"
        className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text disabled:opacity-40"
        data-testid="search-newer"
        disabled={total === 0 || index <= 0}
        onClick={onNewer}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={18} />
      </button>
      <button
        aria-label="Fechar a busca"
        className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text"
        data-testid="search-close"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
