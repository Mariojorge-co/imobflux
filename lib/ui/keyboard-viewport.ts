"use client";

import { useSyncExternalStore } from "react";

export type KeyboardViewport = {
  /** Há um teclado cobrindo parte do layout (campo de texto em foco e a área visível menor que o layout). */
  open: boolean;
  /** Altura da área visível acima do teclado, em px (só vale com `open`). */
  height: number;
  /** Deslocamento da área visível dentro do layout, em px (o iOS rola a página para mostrar o campo). */
  top: number;
};

/** Teclado menor que isto não conta (barra de endereço que encolhe/expande não é teclado). */
export const KEYBOARD_MIN_HEIGHT = 120;

const CLOSED: KeyboardViewport = { open: false, height: 0, top: 0 };

/**
 * Cálculo puro. `layoutHeight` é a altura do layout (window.innerHeight) e `visualHeight`/`offsetTop` vêm do
 * window.visualViewport. No Android com interactive-widget=resizes-content o layout encolhe junto com o teclado: a
 * diferença é ~0, nada é "aberto" aqui e o layout normal (dvh) já serve — o espaço do teclado nunca é reservado duas vezes.
 * No iOS o layout NÃO encolhe: só a área visível diminui, e é aí que este cálculo fixa a conversa acima do teclado.
 */
export function computeKeyboardViewport(input: {
  layoutHeight: number;
  visualHeight: number;
  offsetTop: number;
  editing: boolean;
}): KeyboardViewport {
  const covered = input.layoutHeight - input.visualHeight;
  if (!input.editing || covered < KEYBOARD_MIN_HEIGHT) return CLOSED;
  return { open: true, height: Math.round(input.visualHeight), top: Math.max(0, Math.round(input.offsetTop)) };
}

function isEditable(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return !element.readOnly;
  if (element instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "file", "range", "color", "image", "reset"].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function read(): KeyboardViewport {
  const visual = window.visualViewport;
  // Zoom de pinça também encolhe a área visível: não é teclado.
  if (!visual || visual.scale > 1.05) return CLOSED;
  return computeKeyboardViewport({
    layoutHeight: window.innerHeight,
    visualHeight: visual.height,
    offsetTop: visual.offsetTop,
    editing: isEditable(document.activeElement),
  });
}

let current: KeyboardViewport = CLOSED;
const listeners = new Set<() => void>();

function refresh() {
  const next = read();
  if (next.open === current.open && next.height === current.height && next.top === current.top) return;
  current = next;
  const root = document.documentElement;
  if (next.open) root.setAttribute("data-keyboard-open", "true");
  else root.removeAttribute("data-keyboard-open");
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("resize", refresh);
    window.addEventListener("orientationchange", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    document.addEventListener("focusin", refresh);
    // Ao sair do campo o foco passa por <body> antes do próximo: espera um tique para não piscar.
    document.addEventListener("focusout", onFocusOut);
    refresh();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
      document.removeEventListener("focusin", refresh);
      document.removeEventListener("focusout", onFocusOut);
      current = CLOSED;
      document.documentElement.removeAttribute("data-keyboard-open");
    }
  };
}

function onFocusOut() {
  window.setTimeout(refresh, 50);
}

/** Estado do teclado do celular (e `data-keyboard-open` no <html>, para o CSS compactar o que precisar). */
export function useKeyboardViewport(): KeyboardViewport {
  return useSyncExternalStore(subscribe, () => current, () => CLOSED);
}
