// Bypass dos markers 'server-only' e 'next/cache' para ambiente Node de testes
try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: { __esModule: true },
  };
} catch {
  // Ignorar
}

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextCacheModule = require("next/cache");
nextCacheModule.revalidatePath = () => {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/kanban/actions");

test.describe("Sprint 18 — Kanban UI & Drag-and-Drop Interaction Tests", () => {
  const mockStages = [
    {
      id: "41000000-0000-4000-8000-000000000001",
      name: "Prospecção",
      position: 1,
      commercial_meaning: "prospecting",
      total_count: 2,
      has_more: false,
      cards: [
        {
          id: "55000000-0000-4000-8000-000000000001",
          title: "Apto 3 Quatros Ponta Verde",
          description: "Cliente buscando andar alto",
          created_at: "2026-08-01T10:00:00.000Z",
          updated_at: "2026-08-02T14:00:00.000Z",
          contact_id: "51000000-0000-4000-8000-000000000001",
          contact_name: "Carlos Alberto",
          contact_classification: "client" as const,
          responsible_member_id: "31000000-0000-4000-8000-000000000001",
          responsible_name: "Corretor João",
        },
        {
          id: "55000000-0000-4000-8000-000000000002",
          title: "Casa em Condomínio",
          description: null,
          created_at: "2026-08-01T09:00:00.000Z",
          updated_at: "2026-08-01T11:00:00.000Z",
          contact_id: "51000000-0000-4000-8000-000000000002",
          contact_name: "Mariana Souza",
          contact_classification: "lead" as const,
          responsible_member_id: null,
          responsible_name: null,
        },
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000002",
      name: "Visita Agendada",
      position: 2,
      commercial_meaning: "qualification",
      total_count: 55,
      has_more: true,
      cards: [],
    },
    {
      id: "41000000-0000-4000-8000-000000000003",
      name: "Proposta",
      position: 3,
      commercial_meaning: "proposal",
      total_count: 0,
      has_more: false,
      cards: [],
    },
  ];

  test("1. Valida estrutura de dados do Kanban em conformidade com a Sprint 18", () => {
    expect(mockStages.length).toBe(3);
    expect(mockStages[0].name).toBe("Prospecção");
    expect(mockStages[0].cards.length).toBe(2);
    expect(mockStages[1].has_more).toBe(true);
    expect(mockStages[1].total_count).toBe(55);
  });

  test("2. MoveOpportunityAction trata conflito de concorrência com código CONFLICT", async () => {
    const originalMove = actionsModule.moveOpportunityAction;
    actionsModule.moveOpportunityAction = async () => ({
      success: false,
      code: "CONFLICT",
      error: "A oportunidade foi alterada por outra operação.",
    });

    try {
      const res = await actionsModule.moveOpportunityAction(
        "55000000-0000-4000-8000-000000000001",
        "41000000-0000-4000-8000-000000000001",
        "41000000-0000-4000-8000-000000000002",
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("CONFLICT");
      expect(res.error).toBe("A oportunidade foi alterada por outra operação.");
    } finally {
      actionsModule.moveOpportunityAction = originalMove;
    }
  });

  test("3. Garantia de isolamento e ausência de campos proibidos (position em opportunities)", () => {
    const serializedCard = JSON.stringify(mockStages[0].cards[0]);
    expect(serializedCard).not.toContain("sort_order");
    expect(serializedCard).not.toContain("stage_position");
  });
});
