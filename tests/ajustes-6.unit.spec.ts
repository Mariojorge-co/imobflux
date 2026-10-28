import { expect, test } from "@playwright/test";
import { computeKeyboardViewport, KEYBOARD_MIN_HEIGHT } from "../lib/ui/keyboard-viewport";

// Ajustes 6 — o cálculo da área visível acima do teclado (iOS não redimensiona o layout; só a área visível diminui).

test.describe("Teclado do celular — área visível", () => {
  test("campo em foco e área visível bem menor que o layout: moldura = altura e deslocamento da área visível", () => {
    expect(computeKeyboardViewport({ layoutHeight: 844, visualHeight: 500, offsetTop: 0, editing: true })).toEqual({ open: true, height: 500, top: 0 });
    expect(computeKeyboardViewport({ layoutHeight: 844, visualHeight: 500.4, offsetTop: 36.6, editing: true })).toEqual({ open: true, height: 500, top: 37 });
  });

  test("sem campo em foco não é teclado (barra de endereço, zoom, rolagem)", () => {
    expect(computeKeyboardViewport({ layoutHeight: 844, visualHeight: 500, offsetTop: 0, editing: false }).open).toBe(false);
  });

  test("Android com layout que já encolhe (resizes-content): diferença ~0, nada é reservado duas vezes", () => {
    expect(computeKeyboardViewport({ layoutHeight: 500, visualHeight: 500, offsetTop: 0, editing: true }).open).toBe(false);
  });

  test("diferença pequena (barra do navegador) não conta como teclado", () => {
    expect(computeKeyboardViewport({ layoutHeight: 844, visualHeight: 844 - (KEYBOARD_MIN_HEIGHT - 1), offsetTop: 0, editing: true }).open).toBe(false);
    expect(computeKeyboardViewport({ layoutHeight: 844, visualHeight: 844 - KEYBOARD_MIN_HEIGHT, offsetTop: 0, editing: true }).open).toBe(true);
  });

  test("deslocamento negativo (bounce do iOS) vira 0", () => {
    expect(computeKeyboardViewport({ layoutHeight: 844, visualHeight: 500, offsetTop: -12, editing: true }).top).toBe(0);
  });
});
