import type { Page } from "@playwright/test";

// Auditoria de contraste (WCAG AA) feita no navegador: para cada texto visível, compara a cor do texto com o fundo efetivo
// (compondo os fundos translúcidos dos ancestrais). Texto normal precisa de 4,5:1; texto grande (>= 24px, ou >= 18,66px em
// negrito) precisa de 3:1. Converte qualquer cor CSS (inclusive oklch) para RGB usando um <canvas>.

export type ContrastViolation = {
  text: string;
  selector: string;
  ratio: number;
  required: number;
  foreground: string;
  background: string;
};

export async function auditContrast(page: Page): Promise<ContrastViolation[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    type Rgba = [number, number, number, number];
    const toRgba = (css: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha).concat(alpha) as Rgba;
    };
    const luminance = ([r, g, b]: Rgba) => {
      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const describe = (element: Element) => {
      const parts: string[] = [];
      let node: Element | null = element;
      for (let depth = 0; node && depth < 3; depth += 1) {
        const testId = node.getAttribute("data-testid");
        parts.unshift(testId ? `[${testId}]` : node.tagName.toLowerCase() + (node.id ? `#${node.id}` : ""));
        node = node.parentElement;
      }
      return parts.join(" > ");
    };
    const pageBackground = toRgba(getComputedStyle(document.body).backgroundColor);
    const base: Rgba = pageBackground[3] === 0 ? toRgba(getComputedStyle(document.documentElement).backgroundColor) : pageBackground;
    const effectiveBackground = (element: Element): Rgba => {
      const stack: Rgba[] = [];
      let node: Element | null = element;
      while (node) {
        const color = toRgba(getComputedStyle(node).backgroundColor);
        if (color[3] > 0) stack.push(color);
        if (color[3] === 1) break;
        node = node.parentElement;
      }
      let result: Rgba = base[3] === 0 ? [255, 255, 255, 1] : base;
      for (const layer of stack.reverse()) result = over(layer, result);
      return result;
    };
    const opacityOf = (element: Element) => {
      let value = 1;
      let node: Element | null = element;
      while (node) {
        value *= Number(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      return value;
    };
    const violations: Array<{ text: string; selector: string; ratio: number; required: number; foreground: string; background: string }> = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const element = node.parentElement;
      if (!text || !element || seen.has(element)) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(element.tagName)) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (element.closest("[inert], [aria-hidden='true'], .sr-only")) continue;
      // Texto de campo desabilitado e do overlay de desenvolvimento do Next não entram.
      if (element.closest("nextjs-portal, [data-nextjs-dev-tools-button]")) continue;
      if ((element as HTMLButtonElement).disabled || element.closest("button:disabled, input:disabled")) continue;
      seen.add(element);
      const foreground = toRgba(style.color);
      const opacity = opacityOf(element);
      const background = effectiveBackground(element);
      const effectiveForeground = over([foreground[0], foreground[1], foreground[2], foreground[3] * opacity], background);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const required = large ? 3 : 4.5;
      const ratio = contrast(effectiveForeground, background);
      if (ratio + 0.001 < required) {
        violations.push({
          text: text.slice(0, 50),
          selector: describe(element),
          ratio: Math.round(ratio * 100) / 100,
          required,
          foreground: `rgb(${effectiveForeground.slice(0, 3).map(Math.round).join(",")})`,
          background: `rgb(${background.slice(0, 3).map(Math.round).join(",")})`,
        });
      }
    }
    return violations;
  });
}
