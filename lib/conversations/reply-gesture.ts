// Responder com o gesto: duplo clique (mouse) ou deslizar a bolha para a direita (toque). Regras puras, testadas sem navegador.

/** Elementos em que o duplo clique/deslize NÃO vira resposta: links, botões, campos, mídia e tudo marcado com data-no-reply. */
export const NO_REPLY_SELECTOR =
  'a, button, input, textarea, select, audio, video, img, canvas, summary, [role="button"], [role="menu"], [role="menuitem"], [contenteditable="true"], [data-no-reply]';

export function isReplyGestureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(NO_REPLY_SELECTOR) === null;
}

/** Deslize para responder: bem para a direita, quase sem subir/descer e rápido o bastante. */
export const SWIPE_TRIGGER_PX = 56;
export const SWIPE_MAX_PX = 72;
export const SWIPE_AXIS_LOCK_PX = 10;
export const SWIPE_MAX_MS = 900;

export type SwipeState = { startX: number; startY: number; startAt: number; locked: "none" | "horizontal" | "vertical" };

/** Atualiza o deslize: devolve o deslocamento visual (0 a SWIPE_MAX_PX) e se o eixo ficou travado como vertical (rolagem). */
export function updateSwipe(state: SwipeState, x: number, y: number): { offset: number; locked: SwipeState["locked"] } {
  const dx = x - state.startX;
  const dy = y - state.startY;
  let locked = state.locked;
  if (locked === "none" && (Math.abs(dx) > SWIPE_AXIS_LOCK_PX || Math.abs(dy) > SWIPE_AXIS_LOCK_PX)) {
    locked = Math.abs(dx) > Math.abs(dy) * 1.5 && dx > 0 ? "horizontal" : "vertical";
  }
  if (locked !== "horizontal") return { offset: 0, locked };
  return { offset: Math.max(0, Math.min(SWIPE_MAX_PX, dx)), locked };
}

export function swipeTriggered(state: SwipeState, offset: number, now: number): boolean {
  return state.locked === "horizontal" && offset >= SWIPE_TRIGGER_PX && now - state.startAt <= SWIPE_MAX_MS;
}
