// Tema do aplicativo: claro, escuro ou automático (segue o sistema). A escolha é pessoal e fica neste navegador (localStorage);
// o script de início (`themeInitScript`) aplica a classe `dark` no <html> ANTES de a página aparecer, para não piscar.

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "imobflux:theme";
export const THEME_CHANGE_EVENT = "imobflux:theme-change";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: "Claro",
  dark: "Escuro",
  system: "Automático (segue o sistema)",
};

/** Próxima opção ao clicar no botão do topo: claro → escuro → automático → claro. */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  return current === "light" ? "dark" : current === "dark" ? "system" : "light";
}

/**
 * Script que roda antes da primeira pintura. Tem de ser curto e à prova de erro: qualquer falha (armazenamento bloqueado,
 * modo privado) cai no tema do sistema. Mantém `color-scheme` coerente com o tema.
 */
export const themeInitScript = `(function(){try{var p=null;try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d){r.classList.add("dark")}else{r.classList.remove("dark")}}catch(e){}})();`;

/** Aplica o tema na página agora (usado ao trocar a preferência ou quando o sistema muda). */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Guarda e aplica a preferência. Avisa as outras partes da tela (botão do topo e página de preferências). */
export function saveThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // sem armazenamento: vale só nesta página
  }
  applyResolvedTheme(resolveTheme(preference, systemPrefersDark()));
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}
