"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Check, Clock, PauseCircle, TimerOff } from "lucide-react";
import { ViewportMenu } from "@/components/ui";
import { setConversationSlaModeAction, type SlaModeResult } from "@/lib/conversations/actions";

export type SlaMode = "active" | "paused" | "disabled";

type SlaControlProps = {
  conversationId: string;
  mode: SlaMode;
  /** Resultado do banco depois de mudar o modo (para a tela se atualizar sem recarregar). */
  onChanged: (result: Extract<SlaModeResult, { success: true }>) => void;
};

const OPTIONS: ReadonlyArray<{ mode: SlaMode; label: string; help: string }> = [
  { mode: "active", label: "Prazo ativo", help: "Mostra o tempo de espera e a conversa entra em Prioridades." },
  { mode: "paused", label: "Pausar até o cliente falar de novo", help: "Some das tarjas e de Prioridades; volta sozinho quando o cliente escrever." },
  { mode: "disabled", label: "Desativar o prazo desta conversa", help: "Permanente, até você reativar aqui." },
];

const BUTTON_TEXT: Record<SlaMode, string> = {
  active: "Prazo",
  paused: "Prazo pausado",
  disabled: "Prazo desativado",
};

/** Botão discreto do cabeçalho da conversa individual para controlar o prazo (com o estado visível). */
export function SlaControl({ conversationId, mode, onChanged }: SlaControlProps) {
  const buttonId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const Icon = mode === "paused" ? PauseCircle : mode === "disabled" ? TimerOff : Clock;
  const muted = mode === "active";

  const choose = (next: SlaMode) => {
    setOpen(false);
    if (next === mode) return;
    setError(null);
    startTransition(async () => {
      const result = await setConversationSlaModeAction(conversationId, next);
      if (result.success) onChanged(result);
      else setError(result.error);
    });
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Prazo de resposta desta conversa: ${BUTTON_TEXT[mode].toLowerCase()}`}
        className={[
          "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-pill border px-2 text-caption font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60",
          muted
            ? "border-transparent text-text-muted hover:bg-neutral-soft hover:text-text"
            : "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
        ].join(" ")}
        data-sla-mode={mode}
        data-testid="sla-control"
        disabled={isPending}
        id={buttonId}
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        type="button"
      >
        <Icon aria-hidden="true" size={13} />
        <span className={muted ? "hidden sm:inline" : ""}>{BUTTON_TEXT[mode]}</span>
      </button>
      <ViewportMenu anchorRef={anchorRef} labelledBy={buttonId} onClose={() => setOpen(false)} open={open}>
        {OPTIONS.map((option) => (
          <button
            aria-checked={option.mode === mode}
            className="flex w-full min-w-64 items-start gap-2 px-3 py-2 text-left hover:bg-neutral-soft focus-visible:bg-neutral-soft focus-visible:outline-none"
            data-testid={`sla-option-${option.mode}`}
            key={option.mode}
            onClick={() => choose(option.mode)}
            role="menuitemradio"
            type="button"
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-primary">
              {option.mode === mode ? <Check aria-hidden="true" size={14} /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-body font-medium text-text">{option.label}</span>
              <span className="block text-caption text-text-muted">{option.help}</span>
            </span>
          </button>
        ))}
      </ViewportMenu>
      {error ? (
        <span className="text-caption text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
