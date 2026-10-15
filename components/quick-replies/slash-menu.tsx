"use client";

import { useEffect, useRef } from "react";
import type { QuickReply } from "@/lib/quick-replies/types";
import type { QuickReplyLoadState } from "@/components/quick-replies/use-quick-replies";

type SlashMenuProps = {
  id: string;
  results: QuickReply[];
  activeIndex: number;
  state: QuickReplyLoadState;
  query: string;
  onPick: (reply: QuickReply) => void;
  onHover: (index: number) => void;
};

export const slashOptionId = (menuId: string, index: number) => `${menuId}-option-${index}`;

/**
 * Lista flutuante do atalho "/" (acima da caixa de mensagem). O foco continua na caixa: a navegação é por setas, Enter
 * e Esc, tratados no teclado da própria caixa. Clique do mouse insere sem tirar o foco.
 */
export function SlashMenu({ id, results, activeIndex, state, query, onPick, onHover }: SlashMenuProps) {
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      className="absolute inset-x-0 bottom-full z-30 mb-1 overflow-hidden rounded-card border border-border bg-surface shadow-xl"
      data-testid="slash-menu"
    >
      {state === "loading" || state === "idle" ? (
        <p className="px-3 py-3 text-caption text-text-muted" role="status">
          Carregando respostas rápidas…
        </p>
      ) : state === "error" ? (
        <p className="px-3 py-3 text-caption text-danger" role="alert">
          Não foi possível carregar as respostas rápidas.
        </p>
      ) : results.length === 0 ? (
        <p className="px-3 py-3 text-caption text-text-muted" role="status">
          {query ? `Nenhuma resposta encontrada para “${query}”.` : "Nenhuma resposta rápida cadastrada."}
        </p>
      ) : (
        <ul aria-label="Respostas rápidas" className="max-h-64 overflow-y-auto py-1" id={id} role="listbox">
          {results.map((reply, index) => {
            const active = index === activeIndex;
            return (
              <li
                aria-selected={active}
                className={[
                  "cursor-pointer px-3 py-1.5",
                  active ? "bg-primary/10" : "hover:bg-neutral-soft",
                ].join(" ")}
                id={slashOptionId(id, index)}
                key={reply.id}
                onClick={() => onPick(reply)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                ref={active ? activeRef : undefined}
                role="option"
              >
                <span className="block truncate text-body font-semibold text-text">{reply.title}</span>
                <span className="line-clamp-1 whitespace-pre-line break-words text-caption text-text-muted">{reply.body}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-border/60 px-3 py-1 text-caption text-text-muted">↑↓ navegar · Enter inserir · Esc fechar</p>
    </div>
  );
}
