import { expect, test } from "@playwright/test";
import { placeFloating } from "../lib/ui/floating-position";

const viewport = { width: 1440, height: 900 };
const menu = { width: 192, height: 330 };
const anchorAt = (top: number, left = 800) => ({ top, bottom: top + 32, left, right: left + 32 });

test.describe("Menu flutuante — posição sempre dentro da tela", () => {
  test("com espaço embaixo, abre para baixo", () => {
    const p = placeFloating(anchorAt(100), menu, viewport, "start");
    expect(p.top).toBe(100 + 32 + 4);
  });

  test("sem espaço embaixo (mensagem no fim da lista), vira para cima", () => {
    const p = placeFloating(anchorAt(820), menu, viewport, "start");
    expect(p.top).toBeLessThan(820);
    expect(p.top + menu.height).toBeLessThanOrEqual(820);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  test("não cabe nem em cima nem embaixo (janela baixa): usa o maior lado e rola por dentro, sem sair da tela", () => {
    const tall = { width: 192, height: 700 };
    const p = placeFloating(anchorAt(300), tall, { width: 1000, height: 500 }, "start");
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + Math.min(tall.height, p.maxHeight)).toBeLessThanOrEqual(500 - 8);
    expect(p.maxHeight).toBeLessThan(tall.height);
  });

  test("horizontal: alinha à borda e nunca passa das laterais (celular de 390 px)", () => {
    const phone = { width: 390, height: 844 };
    const right = placeFloating(anchorAt(200, 350), menu, phone, "end");
    expect(right.left + menu.width).toBeLessThanOrEqual(390 - 8);
    expect(right.left).toBeGreaterThanOrEqual(8);
    const left = placeFloating(anchorAt(200, 2), menu, phone, "start");
    expect(left.left).toBe(8);
    const wide = placeFloating(anchorAt(200, 380), menu, phone, "start");
    expect(wide.left + menu.width).toBeLessThanOrEqual(390 - 8);
  });

  test("âncora acima da tela ou abaixo dela ainda devolve uma posição visível", () => {
    for (const top of [-500, 2000]) {
      const p = placeFloating(anchorAt(top), menu, viewport, "end");
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.top + Math.min(menu.height, p.maxHeight)).toBeLessThanOrEqual(900 - 8 + 1);
    }
  });
});
