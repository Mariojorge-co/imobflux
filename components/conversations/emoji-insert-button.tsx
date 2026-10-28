"use client";

import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { ESCAPE_PRIORITY, useEscapeLayer } from "@/lib/ui/escape-stack";

// O painel (e a lista de emojis) só é baixado na primeira vez que alguém abre o seletor.
const EmojiInsertPanel = lazy(() => import("@/components/conversations/emoji-insert-panel"));

type EmojiInsertButtonProps = {
  memberId: string;
  onPick: (emoji: string) => void;
  disabled?: boolean;
  /** Quem usa decide onde o botão aparece (ex.: só no computador). */
  className?: string;
  label?: string;
  testId?: string;
};

/** Botão 😊 + painel de emojis com categorias, busca e recentes. Esc fecha o painel (camada do Esc em camadas). */
export function EmojiInsertButton({ memberId, onPick, disabled, className = "", label = "Inserir emoji", testId = "emoji-insert-button" }: EmojiInsertButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEscapeLayer(open, ESCAPE_PRIORITY.emojiPicker, () => {
    setOpen(false);
    buttonRef.current?.focus();
  });

  // Clicar/tocar fora fecha. O painel fica em portal (data-floating-menu), então conta como "dentro".
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || target.closest(`[data-emoji-panel="${CSS.escape(panelId)}"]`)) return;
      setOpen(false);
      // O toque que fecha também tira o foco ao terminar: devolve o foco ao botão um instante depois.
      window.setTimeout(() => {
        if (document.activeElement === document.body) buttonRef.current?.focus();
      }, 60);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, panelId]);

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={[
          "size-11 shrink-0 items-center justify-center rounded-control border border-border text-text-muted transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
          className,
        ].join(" ")}
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        title={label}
        type="button"
      >
        <Smile aria-hidden="true" size={18} />
      </button>
      <FloatingMenu align="start" anchorRef={buttonRef} data-testid="emoji-insert-menu" open={open}>
        <div data-emoji-panel={panelId}>
          <Suspense fallback={<div className="rounded-card border border-border bg-surface px-3 py-2 text-caption text-text-muted">Carregando…</div>}>
            <EmojiInsertPanel memberId={memberId} onPick={onPick} />
          </Suspense>
        </div>
      </FloatingMenu>
    </>
  );
}
