import { expect, test } from "@playwright/test";
import { reorderCards } from "@/lib/kanban/reorder";

test.describe("Kanban — cálculo de posição", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  test("reordena do primeiro para o meio e do último para o primeiro", () => {
    expect(reorderCards(cards, "a", "c").map((card) => card.id)).toEqual(["b", "a", "c", "d"]);
    expect(reorderCards(cards, "d", "a").map((card) => card.id)).toEqual(["d", "a", "b", "c"]);
  });

  test("insere no fim e preserva a lista quando o cartão não existe", () => {
    expect(reorderCards(cards, "a", null).map((card) => card.id)).toEqual(["b", "c", "d", "a"]);
    expect(reorderCards(cards, "missing", "b")).toEqual(cards);
  });

  test("renumera somente sort_order e preserva updated_at dos cards deslocados", () => {
    const timestamped = cards.map((card, index) => ({
      ...card,
      sort_order: index + 1,
      updated_at: `2026-09-30T10:0${index}:00.000Z`,
    }));
    const reordered = reorderCards(timestamped, "a", "c");

    expect(reordered.map((card) => card.id)).toEqual(["b", "a", "c", "d"]);
    expect(reordered.find((card) => card.id === "b")?.updated_at).toBe(timestamped[1].updated_at);
    expect(reordered.find((card) => card.id === "c")?.updated_at).toBe(timestamped[2].updated_at);
    expect(reordered.find((card) => card.id === "d")?.updated_at).toBe(timestamped[3].updated_at);
    expect(reordered.find((card) => card.id === "a")?.updated_at).toBe(timestamped[0].updated_at);
  });

  test("insere D no topo da coluna destino sem alterar timestamps de A, B ou C", () => {
    const destination = ["a", "b", "c"].map((id, index) => ({
      id,
      sort_order: index + 1,
      updated_at: `2026-09-30T09:0${index}:00.000Z`,
    }));
    const source = [{
      id: "d",
      sort_order: 1,
      updated_at: "2026-09-29T09:00:00.000Z",
    }];

    const reorderedDestination = reorderCards(
      [...destination, ...source],
      "d",
      "a",
    );

    expect(reorderedDestination.map((card) => card.id)).toEqual(["d", "a", "b", "c"]);
    expect(reorderedDestination.find((card) => card.id === "a")?.updated_at).toBe(destination[0].updated_at);
    expect(reorderedDestination.find((card) => card.id === "b")?.updated_at).toBe(destination[1].updated_at);
    expect(reorderedDestination.find((card) => card.id === "c")?.updated_at).toBe(destination[2].updated_at);
  });
});
