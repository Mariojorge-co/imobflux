import type { Page } from "@playwright/test";

export type FieldInfo = {
  tag: string;
  type: string;
  label: string;
  fontSize: number;
  zoom: string;
  classes: string;
};

/**
 * Todo campo de texto visível da tela (input, textarea, select, contenteditable) com o font-size COMPUTADO. No iOS, campo com
 * menos de 16 px faz o navegador dar zoom ao focar. Checkbox, rádio, arquivo, cor, intervalo e botões não contam (não digitam).
 */
export async function auditFields(page: Page): Promise<FieldInfo[]> {
  return page.evaluate(() => {
    const skipTypes = new Set(["checkbox", "radio", "range", "file", "color", "button", "submit", "reset", "image", "hidden"]);
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    return [...document.querySelectorAll<HTMLElement>("input, textarea, select, [contenteditable='true'], [contenteditable='']")]
      .filter((element) => {
        if (!visible(element)) return false;
        if (element instanceof HTMLInputElement && skipTypes.has(element.type)) return false;
        // Campo que o usuário não pode focar (desativado/somente leitura) não dispara zoom.
        if ((element as HTMLInputElement).disabled || (element as HTMLInputElement).readOnly) return false;
        return true;
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        type: element instanceof HTMLInputElement ? element.type : "",
        label: element.getAttribute("aria-label") ?? element.getAttribute("placeholder") ?? element.id ?? "",
        fontSize: parseFloat(getComputedStyle(element).fontSize),
        zoom: getComputedStyle(element).zoom,
        classes: element.className.toString().slice(0, 80),
      }));
  });
}

export const below16 = (fields: FieldInfo[]) => fields.filter((field) => field.fontSize < 16);
