"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { MORE_EMOJIS, QUICK_EMOJIS } from "@/lib/conversations/message-ui";

type EmojiPickerProps = {
  /** Emoji que a pessoa já usou nesta mensagem (aparece marcado; clicar de novo remove). */
  current?: string | null;
  onPick: (emoji: string) => void;
};

/** Seis emojis rápidos e um botão "mais" com uma grade maior. */
export function EmojiPicker({ current, onPick }: EmojiPickerProps) {
  const [more, setMore] = useState(false);

  return (
    <div className="rounded-card border border-border bg-surface p-1.5 shadow-lg" data-testid="emoji-picker">
      <div className="flex items-center gap-0.5">
        {QUICK_EMOJIS.map((emoji) => (
          <button
            aria-label={`Reagir com ${emoji}`}
            aria-pressed={current === emoji}
            className={[
              "flex size-9 items-center justify-center rounded-control text-xl transition-transform hover:scale-110 hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              current === emoji ? "bg-primary/15" : "",
            ].join(" ")}
            data-testid="emoji-quick"
            key={emoji}
            onClick={() => onPick(emoji)}
            type="button"
          >
            {emoji}
          </button>
        ))}
        <button
          aria-expanded={more}
          aria-label="Mais emojis"
          className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="emoji-more"
          onClick={() => setMore((value) => !value)}
          type="button"
        >
          <Plus aria-hidden="true" size={18} />
        </button>
      </div>
      {more ? (
        <div className="mt-1 grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto border-t border-border pt-1" data-testid="emoji-grid">
          {MORE_EMOJIS.map((emoji) => (
            <button
              aria-label={`Reagir com ${emoji}`}
              className="flex size-8 items-center justify-center rounded-control text-lg hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              key={emoji}
              onClick={() => onPick(emoji)}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
