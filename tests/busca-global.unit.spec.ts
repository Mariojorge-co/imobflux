import { expect, test } from "@playwright/test";
import { searchResultHref, splitHighlight } from "../lib/search/highlight";

test.describe("Busca global — destaque e endereço", () => {
  test("destaca todas as ocorrências sem diferenciar maiúsculas", () => {
    expect(splitHighlight("Casa e CASA e casa", "casa")).toEqual([
      { text: "Casa", match: true },
      { text: " e ", match: false },
      { text: "CASA", match: true },
      { text: " e ", match: false },
      { text: "casa", match: true },
    ]);
  });

  test("sem termo ou sem ocorrência devolve o texto inteiro, sem destaque", () => {
    expect(splitHighlight("Olá mundo", "")).toEqual([{ text: "Olá mundo", match: false }]);
    expect(splitHighlight("Olá mundo", "xyz")).toEqual([{ text: "Olá mundo", match: false }]);
    expect(splitHighlight("", "a")).toEqual([]);
  });

  test("caracteres especiais do termo são literais (nada de expressão regular)", () => {
    expect(splitHighlight("preço 100% (à vista) [ok]", "100%")).toEqual([
      { text: "preço ", match: false },
      { text: "100%", match: true },
      { text: " (à vista) [ok]", match: false },
    ]);
    expect(splitHighlight("a.b a*b", ".*")).toEqual([{ text: "a.b a*b", match: false }]);
  });

  test("conteúdo com marcação continua texto puro (quem desenha usa elementos, não HTML)", () => {
    const parts = splitHighlight("<img src=x onerror=alert(1)> oi", "oi");
    expect(parts.map((part) => part.text).join("")).toBe("<img src=x onerror=alert(1)> oi");
    expect(parts.filter((part) => part.match)).toHaveLength(1);
  });

  test("endereço do resultado: mensagem rola até ela; contato abre a conversa", () => {
    expect(searchResultHref("c1", "m 1")).toBe("/conversas/c1?msg=m%201");
    expect(searchResultHref("c1", null)).toBe("/conversas/c1");
  });
});
