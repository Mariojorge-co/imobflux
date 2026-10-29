"use client";

import { useEffect } from "react";
import { guardFieldFont } from "@/lib/ui/field-font-guard";

/**
 * Cinto e suspensório da regra de CSS de 16 px: ao focar um campo de texto no celular, se o tamanho computado ficou abaixo de
 * 16 px (por qualquer motivo), o campo é corrigido na hora, ANTES de o iOS decidir dar zoom. Não faz nada quando o CSS já cumpre.
 */
export function FieldFontGuard() {
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => guardFieldFont(event.target, window.matchMedia("(max-width: 767px), (pointer: coarse)").matches);
    document.addEventListener("focusin", onFocusIn, true);
    // Também no toque, que no iOS vem antes do foco.
    const onTouch = (event: Event) => guardFieldFont(event.target, true);
    document.addEventListener("touchstart", onTouch, { capture: true, passive: true });
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("touchstart", onTouch, true);
    };
  }, []);
  return null;
}
