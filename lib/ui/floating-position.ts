const MARGIN = 8;
const GAP = 4;

export type FloatingPlacement = { top: number; left: number; maxHeight: number };

/**
 * Posição de um menu flutuante junto de um elemento âncora, SEMPRE dentro da área visível: abre para baixo; se faltar espaço
 * embaixo, vira para cima; se não couber em nenhum lado, usa o maior espaço e rola por dentro (maxHeight). Na horizontal,
 * alinha à borda da âncora e nunca passa das bordas da tela. Função pura (testada sem navegador).
 */
export function placeFloating(
  anchor: { top: number; bottom: number; left: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: "start" | "end",
): FloatingPlacement {
  const spaceBelow = viewport.height - anchor.bottom - GAP - MARGIN;
  const spaceAbove = anchor.top - GAP - MARGIN;
  let top: number;
  let maxHeight: number;
  if (size.height <= spaceBelow) {
    top = anchor.bottom + GAP;
    maxHeight = spaceBelow;
  } else if (size.height <= spaceAbove) {
    top = anchor.top - GAP - size.height;
    maxHeight = spaceAbove;
  } else if (spaceBelow >= spaceAbove) {
    top = anchor.bottom + GAP;
    maxHeight = Math.max(spaceBelow, 80);
  } else {
    maxHeight = Math.max(spaceAbove, 80);
    top = anchor.top - GAP - Math.min(size.height, maxHeight);
  }
  const height = Math.min(size.height, maxHeight);
  top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, viewport.height - MARGIN - height));

  let left = align === "end" ? anchor.right - size.width : anchor.left;
  left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, viewport.width - MARGIN - size.width));
  return { top, left, maxHeight };
}
