import { expect, test } from "@playwright/test";
import { NO_REPLY_SELECTOR, SWIPE_MAX_PX, SWIPE_TRIGGER_PX, swipeTriggered, updateSwipe, type SwipeState } from "../lib/conversations/reply-gesture";

const start = (): SwipeState => ({ startX: 100, startY: 300, startAt: 1000, locked: "none" });

test.describe("Responder com o gesto — deslizar (toque)", () => {
  test("movimento pequeno ainda não trava o eixo; deslize horizontal para a direita trava e acompanha o dedo", () => {
    const s = start();
    expect(updateSwipe(s, 104, 302)).toEqual({ offset: 0, locked: "none" });
    const moved = updateSwipe(s, 140, 304);
    expect(moved).toEqual({ offset: 40, locked: "horizontal" });
    s.locked = moved.locked;
    expect(updateSwipe(s, 400, 304).offset).toBe(SWIPE_MAX_PX);
    expect(updateSwipe(s, 60, 304).offset).toBe(0); // voltou para a esquerda
  });

  test("movimento vertical (rolagem) ou para a esquerda trava como vertical e nunca vira resposta", () => {
    expect(updateSwipe(start(), 108, 340)).toEqual({ offset: 0, locked: "vertical" });
    expect(updateSwipe(start(), 60, 302)).toEqual({ offset: 0, locked: "vertical" });
    // diagonal: precisa ser bem mais horizontal que vertical
    expect(updateSwipe(start(), 140, 330).locked).toBe("vertical");
  });

  test("dispara só com deslize longo o bastante, horizontal e rápido", () => {
    const s: SwipeState = { ...start(), locked: "horizontal" };
    expect(swipeTriggered(s, SWIPE_TRIGGER_PX, 1500)).toBe(true);
    expect(swipeTriggered(s, SWIPE_TRIGGER_PX - 1, 1500)).toBe(false);
    expect(swipeTriggered(s, SWIPE_MAX_PX, 1000 + 901)).toBe(false); // devagar demais (parece arrastar/segurar)
    expect(swipeTriggered({ ...s, locked: "vertical" }, SWIPE_MAX_PX, 1200)).toBe(false);
  });

  test("a lista de exceções cobre link, botão, campo, mídia, menu e data-no-reply", () => {
    for (const part of ["a", "button", "input", "textarea", "audio", "video", "img", '[role="menu"]', "[data-no-reply]"]) {
      expect(NO_REPLY_SELECTOR).toContain(part);
    }
  });
});
