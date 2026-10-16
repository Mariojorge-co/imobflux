"use client";

import { useEffect, useId, useState } from "react";
import { Keyboard } from "lucide-react";
import { Button, ModalDialog } from "@/components/ui";
import { handleEscape, isEditableTarget } from "@/lib/ui/escape-stack";

/** Lista de atalhos mostrada pela ajuda ("?"). Mantida aqui para a ajuda e os testes falarem da mesma coisa. */
export const SHORTCUTS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: "Esc", description: "Fecha uma camada por vez: menu da mensagem, emojis, painel, busca, citação, gravação, edição, lista \"/\" e, por fim, a conversa" },
  { keys: "Alt + ↑ / ↓", description: "Conversa anterior / próxima da lista" },
  { keys: "Enter", description: "Envia a mensagem (Shift + Enter quebra a linha)" },
  { keys: "/", description: "Dentro da caixa de mensagem: respostas rápidas" },
  { keys: "/", description: "Fora dos campos de texto: busca em todas as conversas" },
  { keys: "?", description: "Abre esta ajuda (fora dos campos de texto)" },
];

/**
 * Atalhos globais do aplicativo: o Esc em camadas (ver lib/ui/escape-stack) e a ajuda com "?". Não toma Ctrl+F, Ctrl+K,
 * Ctrl+R nem qualquer tecla com Ctrl/Cmd: continuam do navegador.
 */
export function GlobalShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        if (handleEscape(event)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditableTarget(event.target)) {
        if (document.querySelector("dialog[open]")) return;
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        aria-label="Atalhos do teclado"
        className="hidden size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:flex"
        data-testid="shortcuts-button"
        onClick={() => setHelpOpen(true)}
        title="Atalhos do teclado (?)"
        type="button"
      >
        <Keyboard aria-hidden="true" size={18} />
      </button>
      <ModalDialog className="w-[min(calc(100%_-_2rem),34rem)]" labelledBy={titleId} onOpenChange={setHelpOpen} open={helpOpen}>
        {helpOpen ? (
          <div className="space-y-3" data-testid="shortcuts-help">
            <h2 className="text-section-title font-semibold text-text" id={titleId}>Atalhos do teclado</h2>
            <dl className="divide-y divide-border rounded-control border border-border">
              {SHORTCUTS.map((shortcut) => (
                <div className="flex items-start gap-3 px-3 py-2" key={shortcut.keys}>
                  <dt className="w-28 shrink-0"><kbd className="rounded border border-border-strong bg-neutral-soft px-1.5 py-0.5 text-caption font-semibold text-text">{shortcut.keys}</kbd></dt>
                  <dd className="text-body text-text-muted">{shortcut.description}</dd>
                </div>
              ))}
            </dl>
            <div className="flex justify-end">
              <Button onClick={() => setHelpOpen(false)} variant="primary">Fechar</Button>
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </>
  );
}
