"use client";

import { useEffect, useRef } from "react";

// Camadas do Esc. Cada coisa que "abre por cima" (menu da mensagem, seletor de emoji, busca, citação, gravação, edição, lista "/",
// painel lateral, a própria conversa…) registra uma camada com uma prioridade; o Esc fecha UMA camada por vez, da mais alta
// para a mais baixa. Modais nativos (<dialog>) cuidam do próprio Esc e ficam fora desta pilha.

/** Prioridades, da mais alta para a mais baixa (a ordem pedida: de cima para baixo). */
export const ESCAPE_PRIORITY = {
  messageMenu: 100,
  emojiPicker: 95,
  drawer: 90,
  filePreview: 80,
  conversationSearch: 70,
  replyCard: 60,
  voiceRecording: 55,
  messageEdit: 50,
  slashList: 40,
  closeConversation: 10,
} as const;

/** Devolver `false` significa "não tratei este Esc" (a próxima camada tenta). */
export type EscapeHandler = (event: KeyboardEvent) => boolean | void;

type Layer = { priority: number; order: number; handle: EscapeHandler };

const layers = new Set<Layer>();
let counter = 0;

export function registerEscapeLayer(priority: number, handle: EscapeHandler): () => void {
  const layer: Layer = { priority, order: counter++, handle };
  layers.add(layer);
  return () => {
    layers.delete(layer);
  };
}

/** Há um modal nativo aberto: ele trata o próprio Esc. */
function hasOpenNativeDialog(): boolean {
  return typeof document !== "undefined" && document.querySelector("dialog[open]") !== null;
}

/** Tenta fechar a camada mais alta. Devolve true se alguma camada tratou o Esc. */
export function handleEscape(event: KeyboardEvent): boolean {
  if (hasOpenNativeDialog()) return false;
  const ordered = [...layers].sort((left, right) => right.priority - left.priority || right.order - left.order);
  for (const layer of ordered) {
    if (layer.handle(event) !== false) return true;
  }
  return false;
}

/** Registra uma camada enquanto `active` for verdadeiro. */
export function useEscapeLayer(active: boolean, priority: number, onEscape: EscapeHandler) {
  const handlerRef = useRef(onEscape);
  useEffect(() => {
    handlerRef.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    if (!active) return;
    return registerEscapeLayer(priority, (event) => handlerRef.current(event));
  }, [active, priority]);
}

/** O alvo do evento é um campo de texto (onde "?" e outras teclas soltas não devem virar atalho). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
