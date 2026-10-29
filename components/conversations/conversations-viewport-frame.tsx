"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useKeyboardViewport } from "@/lib/ui/keyboard-viewport";

/** Distância do fim da lista dentro da qual "estava no fim" (a última mensagem continua à vista quando o teclado sobe). */
const NEAR_BOTTOM_PX = 160;

/** Área visível menor que isto (celular deitado com o teclado aberto): o cabeçalho da conversa se esconde para sobrar espaço às mensagens. */
const COMPACT_BELOW_PX = 360;

/**
 * Moldura das rotas /conversas. Sem teclado: altura da tela menos a barra superior (dvh). Com o teclado do iOS aberto, que
 * não redimensiona o layout, a moldura é fixada na área visível (visualViewport: altura e deslocamento), de modo que a caixa
 * de mensagem fica logo acima do teclado e a lista rola dentro do que sobra. No Android o layout já encolhe sozinho
 * (interactive-widget): lá o teclado não é "aberto" para este cálculo e nada é reservado duas vezes.
 */
export function ConversationsViewportFrame({ children }: { children: ReactNode }) {
  const keyboard = useKeyboardViewport();
  const frameRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);

  // Lembra se a lista estava no fim antes do teclado mudar a altura (scroll não borbulha: captura).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.getAttribute("role") === "log") {
        wasNearBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < NEAR_BOTTOM_PX;
      }
    };
    frame.addEventListener("scroll", onScroll, true);
    return () => frame.removeEventListener("scroll", onScroll, true);
  }, []);

  useEffect(() => {
    if (!wasNearBottomRef.current) return;
    const log = frameRef.current?.querySelector<HTMLElement>('[role="log"]');
    if (log) log.scrollTop = log.scrollHeight;
  }, [keyboard.open, keyboard.height]);

  return (
    <div
      className="flex h-[calc(100dvh-64px-env(safe-area-inset-top))] w-full flex-col overflow-hidden bg-background"
      data-keyboard-compact={keyboard.open && keyboard.height < COMPACT_BELOW_PX ? "true" : undefined}
      data-keyboard-open={keyboard.open ? "true" : undefined}
      data-testid="conversations-frame"
      ref={frameRef}
      style={keyboard.open ? { position: "fixed", insetInline: 0, top: keyboard.top, height: keyboard.height, zIndex: 40 } : undefined}
    >
      {children}
    </div>
  );
}
