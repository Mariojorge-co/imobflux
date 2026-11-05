import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Páginas de erro e 404 em português: texto fixo, sem mensagem técnica, botões de 44 px.
// (O Playwright troca o JSX pelo runtime de componentes, então aqui se confere o código-fonte; o 404 real é testado no navegador
// em tests/paginas-erro.spec.ts.)

const read = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");

test.describe("páginas de erro e 404 (código)", () => {
  for (const file of ["app/error.tsx", "app/global-error.tsx"]) {
    test(`${file}: texto amigável, duas ações e nada técnico`, () => {
      const source = read(file);
      expect(source).toContain("Algo deu errado.");
      expect(source).toContain("Tente de novo.");
      expect(source).toContain("Tentar de novo");
      expect(source).toContain("Ir para o Hoje");
      expect(source).toContain('href="/hoje"');
      expect(source).toContain("unstable_retry");
      // O erro real nunca é lido, mostrado nem escrito no console do navegador.
      expect(source).not.toMatch(/error\.message|error\.stack|console\.(log|error|warn)|JSON\.stringify\(error/);
    });
  }

  test("a tela comum usa botões de 44 px, tokens do tema e role=alert no erro", () => {
    const source = read("components/errors/error-screen.tsx");
    expect(source).toContain("min-h-11");
    expect(source).toContain("min-w-11");
    expect(source).toContain('role={kind === "error" ? "alert" : undefined}');
    expect(source).toContain("text-text-muted");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  test("404 em português com volta para o Hoje", () => {
    const source = read("app/not-found.tsx");
    expect(source).toContain("Página não encontrada");
    expect(source).toContain("Ir para o Hoje");
    expect(source).toContain('href="/hoje"');
  });
});
