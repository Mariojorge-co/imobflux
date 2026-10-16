"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  THEME_CHANGE_EVENT,
  THEME_LABELS,
  applyResolvedTheme,
  nextThemePreference,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
  systemPrefersDark,
  type ThemePreference,
} from "@/lib/ui/theme";

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Preferência atual (lida do navegador). No servidor vale "system"; o script de início já pintou o tema certo. */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribe, readThemePreference, () => "system" as ThemePreference);
  // No modo automático, acompanha o sistema em tempo real.
  useEffect(() => {
    if (preference !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyResolvedTheme(resolveTheme("system", systemPrefersDark()));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);
  return [preference, useCallback((next: ThemePreference) => saveThemePreference(next), [])];
}

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Botão do topo: troca claro → escuro → automático. */
export function ThemeCycleButton() {
  const [preference, setPreference] = useThemePreference();
  const Icon = ICONS[preference];
  return (
    <button
      aria-label={`Tema: ${THEME_LABELS[preference]}. Clique para trocar`}
      className="flex size-9 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      data-testid="theme-cycle"
      data-theme-preference={preference}
      onClick={() => setPreference(nextThemePreference(preference))}
      suppressHydrationWarning
      title={`Tema: ${THEME_LABELS[preference]}`}
      type="button"
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  );
}

/** Escolha completa (página de preferências): três opções. */
export function ThemeChooser() {
  const [preference, setPreference] = useThemePreference();
  return (
    <div aria-label="Tema do aplicativo" className="grid gap-2 sm:grid-cols-3" role="radiogroup">
      {(["light", "dark", "system"] as const).map((option) => {
        const Icon = ICONS[option];
        const selected = preference === option;
        return (
          <button
            aria-checked={selected}
            className={[
              "flex min-h-14 items-center gap-3 rounded-card border px-4 text-left text-body font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selected ? "border-primary bg-primary/10 text-text" : "border-border bg-surface text-text-muted hover:bg-neutral-soft",
            ].join(" ")}
            data-testid={`theme-option-${option}`}
            key={option}
            onClick={() => setPreference(option)}
            role="radio"
            type="button"
          >
            <Icon aria-hidden="true" size={20} />
            {THEME_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
