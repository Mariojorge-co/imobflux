/** Menos que isto em um campo de texto faz o iOS dar zoom ao focar. */
export const FIELD_MIN_FONT_PX = 16;

const NON_TEXT_TYPES = new Set(["checkbox", "radio", "range", "file", "color", "button", "submit", "reset", "image", "hidden"]);

/** Campo em que se digita (o que dispara o zoom do iOS). */
export function isTextField(element: unknown): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_TYPES.has(element.type);
  return element.isContentEditable;
}

let fixes = 0;

/** Quantas vezes a guarda precisou corrigir um campo nesta sessão (aparece no diagnóstico de tela). */
export function guardFixCount(): number {
  return fixes;
}

/** Corrige o campo se o tamanho computado estiver abaixo de 16 px (só em celular/toque). Devolve se corrigiu. */
export function guardFieldFont(target: unknown, enabled: boolean): boolean {
  if (!enabled || !isTextField(target)) return false;
  const size = parseFloat(getComputedStyle(target).fontSize);
  if (!(size < FIELD_MIN_FONT_PX)) return false;
  target.style.setProperty("font-size", `${FIELD_MIN_FONT_PX}px`, "important");
  fixes += 1;
  return true;
}
