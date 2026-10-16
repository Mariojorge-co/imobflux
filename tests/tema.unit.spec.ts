import { expect, test } from "@playwright/test";
import { nextThemePreference, parseThemePreference, resolveTheme, themeInitScript, THEME_STORAGE_KEY } from "../lib/ui/theme";

test.describe("Tema", () => {
  test("preferência inválida ou ausente vira automático", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("system")).toBe("system");
    for (const bad of [null, undefined, "", "roxo", 7, {}]) expect(parseThemePreference(bad)).toBe("system");
  });

  test("automático segue o sistema; claro e escuro vencem o sistema", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("o botão do topo percorre claro → escuro → automático → claro", () => {
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
    expect(nextThemePreference("system")).toBe("light");
  });

  test("o script de início é curto, usa a chave certa, não quebra sem armazenamento e só mexe na classe dark", () => {
    expect(themeInitScript).toContain(THEME_STORAGE_KEY);
    expect(themeInitScript.length).toBeLessThan(700);
    expect(themeInitScript).toContain("try{");
    expect(themeInitScript).toContain("prefers-color-scheme: dark");
    expect(themeInitScript).not.toContain("fetch");
    // Executa em um ambiente simulado: armazenamento que lança erro não impede de usar o tema do sistema.
    const classes = new Set<string>();
    const root = { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } };
    const env = {
      localStorage: { getItem: () => { throw new Error("bloqueado"); } },
      matchMedia: () => ({ matches: true }),
      document: { documentElement: root },
    };
    new Function("localStorage", "window", "document", themeInitScript)(env.localStorage, env, env.document);
    expect(classes.has("dark")).toBe(true);
    // Preferência "light" salva vence o sistema escuro.
    classes.add("dark");
    const light = { ...env, localStorage: { getItem: () => "light" } };
    new Function("localStorage", "window", "document", themeInitScript)(light.localStorage, light, light.document);
    expect(classes.has("dark")).toBe(false);
  });
});
