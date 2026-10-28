"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { EMOJI_CATEGORIES } from "@/lib/conversations/emoji-data";
import { emojiRecentsKey, parseEmojiRecents, pushEmojiRecent, searchEmojis } from "@/lib/conversations/emoji-picker-model";

type EmojiInsertPanelProps = {
  memberId: string;
  onPick: (emoji: string) => void;
};

function readRecents(memberId: string): string[] {
  try {
    return parseEmojiRecents(window.localStorage.getItem(emojiRecentsKey(memberId)));
  } catch {
    return [];
  }
}

function EmojiButton({ emoji, label }: { emoji: string; label: string }) {
  return (
    <button
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-control text-xl hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-emoji={emoji}
      data-testid="emoji-insert-item"
      type="button"
    >
      {emoji}
    </button>
  );
}

/** Painel do seletor: busca, recentes (por pessoa, neste navegador) e categorias. Carregado só quando alguém abre o seletor. */
export default function EmojiInsertPanel({ memberId, onPick }: EmojiInsertPanelProps) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState(EMOJI_CATEGORIES[0].id);
  const [recents, setRecents] = useState<string[]>(() => readRecents(memberId));
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const pick = (emoji: string) => {
    const next = pushEmojiRecent(recents, emoji);
    setRecents(next);
    try {
      window.localStorage.setItem(emojiRecentsKey(memberId), JSON.stringify(next));
    } catch {
      // sem armazenamento: os recentes valem só até fechar a página
    }
    onPick(emoji);
  };

  const results = searchEmojis(query);
  const searching = query.trim() !== "";
  const category = EMOJI_CATEGORIES.find((item) => item.id === categoryId) ?? EMOJI_CATEGORIES[0];

  return (
    <div
      className="flex w-[19.5rem] max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-card border border-border bg-surface p-2 shadow-lg"
      data-testid="emoji-insert-panel"
      onClick={(event) => {
        const button = (event.target as Element).closest<HTMLElement>("[data-emoji]");
        if (button?.dataset.emoji) pick(button.dataset.emoji);
      }}
    >
      <label className="relative block">
        <span className="sr-only">Buscar emoji</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" size={14} />
        <input
          autoComplete="off"
          className="h-9 w-full rounded-control border border-border bg-background pl-8 pr-2 text-body text-text placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          data-testid="emoji-insert-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar emoji (ex.: casa, ok, parabéns)"
          ref={searchRef}
          type="search"
          value={query}
        />
      </label>

      {searching ? (
        <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto" data-testid="emoji-insert-results">
          {results.length === 0 ? (
            <p className="col-span-8 px-1 py-3 text-center text-caption text-text-muted" data-testid="emoji-insert-empty">Nenhum emoji encontrado.</p>
          ) : (
            results.map((entry) => <EmojiButton emoji={entry.emoji} key={entry.emoji} label={entry.keywords.split(" ")[0] ? `${entry.emoji} ${entry.keywords.split(" ")[0]}` : entry.emoji} />)
          )}
        </div>
      ) : (
        <>
          {recents.length > 0 ? (
            <div>
              <p className="px-1 pb-0.5 text-caption font-semibold text-text-muted">Recentes</p>
              <div className="grid grid-cols-8 gap-0.5" data-testid="emoji-insert-recents">
                {recents.slice(0, 8).map((emoji) => (
                  <EmojiButton emoji={emoji} key={emoji} label={`${emoji} recente`} />
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex gap-0.5 border-b border-border pb-1" role="tablist">
            {EMOJI_CATEGORIES.map((item) => (
              <button
                aria-label={item.label}
                aria-selected={item.id === category.id}
                className={[
                  "flex size-9 items-center justify-center rounded-control text-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  item.id === category.id ? "bg-primary-soft" : "hover:bg-neutral-soft",
                ].join(" ")}
                data-testid={`emoji-category-${item.id}`}
                key={item.id}
                onClick={() => setCategoryId(item.id)}
                role="tab"
                title={item.label}
                type="button"
              >
                {item.icon}
              </button>
            ))}
          </div>
          <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto" data-testid="emoji-insert-grid">
            {category.items.map((raw) => {
              const [emoji, keywords] = raw.split("|");
              return <EmojiButton emoji={emoji} key={emoji} label={`${emoji} ${keywords.split(" ")[0]}`} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}
