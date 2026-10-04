export function reorderCards<T extends { id: string }>(
  cards: readonly T[],
  movingId: string,
  beforeId: string | null,
): T[] {
  const moving = cards.find((card) => card.id === movingId);
  if (!moving) return [...cards];

  const remaining = cards.filter((card) => card.id !== movingId);
  const insertionIndex = beforeId
    ? remaining.findIndex((card) => card.id === beforeId)
    : remaining.length;
  const next = [...remaining];
  next.splice(insertionIndex < 0 ? remaining.length : insertionIndex, 0, moving);
  return next;
}
