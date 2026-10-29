"use client";

import { Children, useState } from "react";

type LimitedListProps = {
  children: React.ReactNode;
  /** Quantos itens aparecem antes do "Ver mais". */
  limit?: number;
  /** Elemento da lista: `ul` (itens `li`) ou `div` (itens soltos). */
  as?: "ul" | "div";
  className?: string;
  "data-testid"?: string;
};

export const DEFAULT_LIST_LIMIT = 6;

/** Lista com limite: mostra os primeiros itens e um botão "Ver mais" (alvo de toque de 44 px) para o resto. */
export function LimitedList({ children, limit = DEFAULT_LIST_LIMIT, as = "ul", className, ...rest }: LimitedListProps) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const hidden = items.length - limit;
  const visible = expanded || hidden <= 0 ? items : items.slice(0, limit);
  const List = as;

  return (
    <>
      <List className={className} data-testid={rest["data-testid"]}>
        {visible}
      </List>
      {hidden > 0 ? (
        <button
          aria-expanded={expanded}
          className="flex min-h-11 w-full items-center justify-center border-t border-border px-3 text-sm font-medium text-primary transition-colors hover:bg-neutral-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="hoje-see-more"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? "Ver menos" : `Ver mais (${hidden})`}
        </button>
      ) : null}
    </>
  );
}
