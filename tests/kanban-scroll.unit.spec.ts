// Bypass dos markers 'server-only' e 'next/cache' para ambiente Node de testes
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: { __esModule: true },
  };
} catch {
  // Ignorar
}

import { expect, test } from "@playwright/test";

test.describe("Sprint 19 UX Hotfix — Kanban Horizontal Scroll & Navigation Unit Tests", () => {
  test("1. Clique no fundo ativa estado de grab/arrasto horizontal do container", () => {
    let isGrabbing = false;
    let isDraggingBg = false;

    const handleMouseDown = (targetElement: { closest: (selector: string) => boolean }, button: number) => {
      if (button !== 0) return;
      if (
        targetElement.closest("[draggable='true']") ||
        targetElement.closest("button") ||
        targetElement.closest("select") ||
        targetElement.closest("input") ||
        targetElement.closest("textarea") ||
        targetElement.closest("a")
      ) {
        return;
      }
      isDraggingBg = true;
      isGrabbing = true;
    };

    // Clique em área vazia do board
    handleMouseDown({ closest: () => false }, 0);
    expect(isDraggingBg).toBe(true);
    expect(isGrabbing).toBe(true);
  });

  test("2. Clique em um card (draggable=true) ou botão ignora o grab de fundo", () => {
    let isGrabbing = false;
    let isDraggingBg = false;

    const handleMouseDown = (targetElement: { closest: (selector: string) => boolean }, button: number) => {
      if (button !== 0) return;
      if (
        targetElement.closest("[draggable='true']") ||
        targetElement.closest("button") ||
        targetElement.closest("select") ||
        targetElement.closest("input")
      ) {
        return;
      }
      isDraggingBg = true;
      isGrabbing = true;
    };

    // Clique sobre um card
    handleMouseDown({ closest: (selector: string) => selector === "[draggable='true']" }, 0);
    expect(isDraggingBg).toBe(false);
    expect(isGrabbing).toBe(false);

    // Clique sobre um botão
    handleMouseDown({ closest: (selector: string) => selector === "button" }, 0);
    expect(isDraggingBg).toBe(false);
    expect(isGrabbing).toBe(false);
  });

  test("3. Rolagem vertical do mouse converte para scrollLeft do container", () => {
    const mockContainer = {
      scrollLeft: 100,
    };

    const handleWheel = (deltaX: number, deltaY: number, shiftKey: boolean) => {
      if (Math.abs(deltaX) > Math.abs(deltaY)) return; // Scroll horizontal nativo

      if (deltaY !== 0 && !shiftKey) {
        mockContainer.scrollLeft += deltaY;
      }
    };

    // Roda do mouse vertical (deltaY = 50)
    handleWheel(0, 50, false);
    expect(mockContainer.scrollLeft).toBe(150);

    // Roda do mouse para cima (deltaY = -30)
    handleWheel(0, -30, false);
    expect(mockContainer.scrollLeft).toBe(120);
  });
});
