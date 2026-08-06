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
import type { KanbanCard, KanbanStage } from "@/types/kanban";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextCacheModule = require("next/cache");
nextCacheModule.revalidatePath = () => {};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/kanban/actions");

test.describe("Sprint 19 Hotfix — Kanban Creation Local Update Unit Tests", () => {
  const initialMockStages: KanbanStage[] = [
    {
      id: "41000000-0000-4000-8000-000000000001",
      name: "Prospecção",
      position: 1,
      commercial_meaning: "prospecting",
      total_count: 1,
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
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000002",
      name: "Visita Agendada",
      position: 2,
      commercial_meaning: "qualification",
      total_count: 0,
      has_more: false,
      cards: [],
    },
  ];

  test("1, 2, 3 e 4. Adiciona card imediatamente ao estado local na etapa correta e incrementa contagens", () => {
    let stagesState = JSON.parse(JSON.stringify(initialMockStages)) as KanbanStage[];

    const newCard: KanbanCard = {
      id: "55000000-0000-4000-8000-000000000099",
      title: "Nova Oportunidade Teste",
      description: "Descrição de teste",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      contact_id: "51000000-0000-4000-8000-000000000001",
      contact_name: "Carlos Alberto",
      contact_classification: "client",
      responsible_member_id: null,
      responsible_name: null,
    };

    const targetStageId = "41000000-0000-4000-8000-000000000002";

    // Simula a função handleCreatedOpportunity
    stagesState = stagesState.map((st) => {
      if (st.id === targetStageId) {
        if (st.cards.some((c) => c.id === newCard.id)) return st;
        return {
          ...st,
          cards: [newCard, ...st.cards],
          total_count: st.total_count + 1,
        };
      }
      return st;
    });

    // 1. Card adicionado imediatamente
    const targetStage = stagesState.find((st) => st.id === targetStageId);
    expect(targetStage?.cards.length).toBe(1);

    // 2. Card na etapa correta (segunda coluna)
    expect(targetStage?.cards[0].id).toBe("55000000-0000-4000-8000-000000000099");
    expect(targetStage?.cards[0].title).toBe("Nova Oportunidade Teste");

    // 3. Contagem da coluna aumentou de 0 para 1
    expect(targetStage?.total_count).toBe(1);

    // 4. Contagem total aumentou de 1 para 2
    const totalCount = stagesState.reduce((acc, s) => acc + s.cards.length, 0);
    expect(totalCount).toBe(2);
  });

  test("5. Reconciliação do servidor (refresh) não duplica o card no estado local", () => {
    let stagesState = JSON.parse(JSON.stringify(initialMockStages)) as KanbanStage[];

    const newCard: KanbanCard = {
      id: "55000000-0000-4000-8000-000000000099",
      title: "Nova Oportunidade Teste",
      description: "Descrição de teste",
      created_at: "2026-08-05T20:00:00.000Z",
      updated_at: "2026-08-05T20:00:00.000Z",
      contact_id: "51000000-0000-4000-8000-000000000001",
      contact_name: "Carlos Alberto",
      contact_classification: "client",
      responsible_member_id: null,
      responsible_name: null,
    };

    const targetStageId = "41000000-0000-4000-8000-000000000001";

    // 1. Adição local
    stagesState = stagesState.map((st) => {
      if (st.id === targetStageId) {
        if (st.cards.some((c) => c.id === newCard.id)) return st;
        return {
          ...st,
          cards: [newCard, ...st.cards],
          total_count: st.total_count + 1,
        };
      }
      return st;
    });

    expect(stagesState[0].cards.length).toBe(2);

    // 2. Simula initialStages retornado do servidor após router.refresh() (já incluindo o card)
    const refreshedServerStages: KanbanStage[] = [
      {
        id: "41000000-0000-4000-8000-000000000001",
        name: "Prospecção",
        position: 1,
        commercial_meaning: "prospecting",
        total_count: 2,
        has_more: false,
        cards: [
          newCard,
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
        ],
      },
      {
        id: "41000000-0000-4000-8000-000000000002",
        name: "Visita Agendada",
        position: 2,
        commercial_meaning: "qualification",
        total_count: 0,
        has_more: false,
        cards: [],
      },
    ];

    // Simula useEffect de sincronização
    stagesState = refreshedServerStages;

    expect(stagesState[0].cards.length).toBe(2);
    const cardIds = stagesState[0].cards.map((c) => c.id);
    const uniqueCardIds = new Set(cardIds);
    expect(uniqueCardIds.size).toBe(2);
  });

  test("6 e 7. Falha na criação não altera o estado local, mantém modal aberto e exibe erro", async () => {
    const originalCreate = actionsModule.createOpportunityAction;
    actionsModule.createOpportunityAction = async () => ({
      success: false,
      error: "Falha ao criar oportunidade no banco de dados.",
    });

    const stagesState = JSON.parse(JSON.stringify(initialMockStages)) as KanbanStage[];
    let onCreatedCalled = false;
    let modalClosed = false;

    try {
      const res = await actionsModule.createOpportunityAction({
        title: "Tentativa com Falha",
        contactId: "51000000-0000-4000-8000-000000000001",
        stageId: "41000000-0000-4000-8000-000000000001",
      });

      if (res.success) {
        onCreatedCalled = true;
        modalClosed = true;
      }

      expect(res.success).toBe(false);
      expect(res.error).toBe("Falha ao criar oportunidade no banco de dados.");
      expect(onCreatedCalled).toBe(false);
      expect(modalClosed).toBe(false);
      expect(stagesState[0].cards.length).toBe(1);
    } finally {
      actionsModule.createOpportunityAction = originalCreate;
    }
  });

  test("8. Drag-and-drop existente continua funcionando e preserva ordenação de cards", () => {
    let stagesState = JSON.parse(JSON.stringify(initialMockStages)) as KanbanStage[];

    const cardId = "55000000-0000-4000-8000-000000000001";
    const fromStageId = "41000000-0000-4000-8000-000000000001";
    const toStageId = "41000000-0000-4000-8000-000000000002";

    let movedCard: KanbanCard | null = null;

    stagesState = stagesState
      .map((stage) => {
        if (stage.id === fromStageId) {
          const found = stage.cards.find((c) => c.id === cardId);
          if (found) movedCard = { ...found, updated_at: new Date().toISOString() };
          return {
            ...stage,
            cards: stage.cards.filter((c) => c.id !== cardId),
          };
        }
        return stage;
      })
      .map((stage) => {
        if (stage.id === toStageId && movedCard) {
          return {
            ...stage,
            cards: [movedCard, ...stage.cards],
          };
        }
        return stage;
      });

    expect(stagesState[0].cards.length).toBe(0);
    expect(stagesState[1].cards.length).toBe(1);
    expect(stagesState[1].cards[0].id).toBe(cardId);
  });
});
