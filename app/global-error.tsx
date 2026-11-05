"use client";

import { useEffect } from "react";
import "./globals.css";
import {
  ErrorScreen,
  ERROR_BUTTON_CLASSES,
  ERROR_PRIMARY_CLASSES,
  ERROR_SECONDARY_CLASSES,
} from "@/components/errors/error-screen";
import { THEME_STORAGE_KEY, parseThemePreference, resolveTheme } from "@/lib/ui/theme";

// Último recurso: o layout raiz falhou, então esta tela traz o próprio <html>. Aplica o tema salvo (ou o do sistema) ao montar;
// links usam <a> comum para recarregar tudo. Sem mensagem técnica.
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    try {
      const stored = parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
      const dark = resolveTheme(stored, window.matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      // sem armazenamento: fica no tema claro
    }
  }, []);

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <meta content="light dark" name="color-scheme" />
        <title>Algo deu errado · ImobFlux</title>
      </head>
      <body>
        <ErrorScreen
          actions={
            <>
              <button className={`${ERROR_BUTTON_CLASSES} ${ERROR_PRIMARY_CLASSES}`} onClick={unstable_retry} type="button">
                Tentar de novo
              </button>
              <a className={`${ERROR_BUTTON_CLASSES} ${ERROR_SECONDARY_CLASSES}`} href="/hoje">
                Ir para o Hoje
              </a>
            </>
          }
          description="Tente de novo. Se continuar, avise o suporte."
          title="Algo deu errado."
        />
      </body>
    </html>
  );
}
