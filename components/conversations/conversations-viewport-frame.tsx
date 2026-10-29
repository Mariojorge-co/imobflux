"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useKeyboardViewport } from "@/lib/ui/keyboard-viewport";

/** Distância do fim da lista dentro da qual "estava no fim" (a última mensagem continua à vista quando o teclado sobe). */
const NEAR_BOTTOM_PX = 160;

/** Área visível menor que isto (celular deitado com o teclado aberto): o cabeçalho da conversa se esconde para sobrar espaço às mensagens. */
const COMPACT_BELOW_PX = 360;

/**
 * Moldura das rotas /conversas. No celular/tablet (até lg) a RAIZ do app fica fixa na tela inteira (`position: fixed; inset: 0`, regra em globals.css) e a moldura
 * ocupa o que sobra abaixo da barra superior: com viewport-fit=cover isso inclui a área da barra de início do iPhone (a caixa de
 * mensagem pinta essa área com a cor dela, dentro da caixa), então nunca sobra uma faixa do fundo da página. Não depende de dvh
 * (que no iOS instalado pode ser menor que a tela). Os painéis sobrepostos continuam acima da barra superior (mesmo contexto de empilhamento).
 * No computador (lg+) segue a conta com dvh ao lado da barra lateral. Sem teclado: altura da tela menos a barra superior (dvh). Com o teclado do iOS aberto, que
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
      className="flex w-full flex-col overflow-hidden bg-background max-lg:h-full lg:h-[calc(100dvh-64px-env(safe-area-inset-top))]"
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
