import { expect, test } from "@playwright/test";
import { EMOJI_CATEGORIES, EMOJI_MAX_RECENTS } from "../lib/conversations/emoji-data";
import {
  ALL_EMOJIS,
  emojiRecentsKey,
  parseEmojiRecents,
  pushEmojiRecent,
  searchEmojis,
} from "../lib/conversations/emoji-picker-model";
import { draftPreview } from "../lib/conversations/drafts";
import { insertAtCursor } from "../lib/quick-replies/insert";

test.describe("Seletor de emoji — dados e busca", () => {
  test("todas as categorias têm itens no formato emoji|palavras e não há emoji repetido", () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThanOrEqual(5);
    const seen = new Set<string>();
    for (const category of EMOJI_CATEGORIES) {
      expect(category.items.length).toBeGreaterThan(10);
      for (const raw of category.items) {
        expect(raw).toMatch(/^.+\|[a-z0-9 ]+$/);
        const emoji = raw.slice(0, raw.indexOf("|"));
        expect(seen.has(emoji), `repetido: ${emoji}`).toBe(false);
        seen.add(emoji);
      }
    }
    expect(ALL_EMOJIS.length).toBe(seen.size);
  });

  test("a busca ignora acentos e maiúsculas e exige todas as palavras", () => {
    expect(searchEmojis("CASA").map((entry) => entry.emoji)).toContain("🏠");
    expect(searchEmojis("coração").map((entry) => entry.emoji)).toContain("❤️");
    expect(searchEmojis("aperto mao").map((entry) => entry.emoji)).toContain("🤝");
    expect(searchEmojis("casa chave")).toEqual([]);
    expect(searchEmojis("   ")).toEqual([]);
    expect(searchEmojis("xyzxyz")).toEqual([]);
  });
});

test.describe("Seletor de emoji — recentes por pessoa", () => {
  test("o último escolhido vai para a frente, sem repetir e com limite", () => {
    expect(pushEmojiRecent(["😀", "👍"], "👍")).toEqual(["👍", "😀"]);
    const many = Array.from({ length: EMOJI_MAX_RECENTS + 5 }, (_, index) => `e${index}`);
    expect(pushEmojiRecent(many, "🏠")).toHaveLength(EMOJI_MAX_RECENTS);
    expect(pushEmojiRecent(many, "🏠")[0]).toBe("🏠");
  });

  test("valor guardado quebrado ou estranho vira lista vazia; cada pessoa tem a própria chave", () => {
    expect(parseEmojiRecents(null)).toEqual([]);
    expect(parseEmojiRecents("não é json")).toEqual([]);
    expect(parseEmojiRecents('{"a":1}')).toEqual([]);
    expect(parseEmojiRecents('["😀", 5, "", "👍"]')).toEqual(["😀", "👍"]);
    expect(emojiRecentsKey("a")).not.toBe(emojiRecentsKey("b"));
  });

  test("insere no cursor, substitui a seleção e respeita o limite", () => {
    expect(insertAtCursor("olá mundo", 3, 3, "😊", 100)).toEqual({ value: "olá😊 mundo", caret: 3 + "😊".length });
    expect(insertAtCursor("olá mundo", 4, 9, "🏠", 100)?.value).toBe("olá 🏠");
    expect(insertAtCursor("abc", null, null, "😊", 100)?.value).toBe("abc😊");
    expect(insertAtCursor("abc", 3, 3, "😊", 4)).toBeNull();
  });
});

test.describe("Rascunho na lista de conversas", () => {
  test("mostra o começo do texto, sem quebras de linha, cortado em 60 caracteres", () => {
    expect(draftPreview("Bom dia,\n\n  tudo bem?")).toBe("Bom dia, tudo bem?");
    const long = draftPreview("x".repeat(200));
    expect(long.length).toBe(60);
    expect(long.endsWith("…")).toBe(true);
  });

  test("sem texto: só a citação mostra a quem a resposta se dirige; sem nada, não há rascunho", () => {
    expect(draftPreview("", "Maria")).toBe("respondendo a Maria");
    expect(draftPreview("   ", "Maria")).toBe("respondendo a Maria");
    expect(draftPreview("oi", "Maria")).toBe("oi");
    expect(draftPreview("", null)).toBe("");
    expect(draftPreview(undefined)).toBe("");
    expect(draftPreview("   \n ")).toBe("");
  });
});
