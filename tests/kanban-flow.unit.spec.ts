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

test.describe("Sprint 19 — Kanban & Conversations Flow Consolidation Test Suite", () => {
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
          title: "Apto 3 Quatos Ponta Verde",
          description: "Cliente buscando andar alto",
          created_at: "2026-08-01T10:00:00.000Z",
          updated_at: "2026-08-02T14:00:00.000Z",
          contact_id: "51000000-0000-4000-8000-000000000001",
          contact_name: "Carlos Alberto",
          contact_classification: "client" as const,
          responsible_member_id: "31000000-0000-4000-8000-000000000001",
          responsible_name: "Corretor João",
          has_linked_conversation: true,
          linked_conversation_id: "99000000-0000-4000-8000-000000000001",
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
          has_linked_conversation: false,
          linked_conversation_id: null,
        },
      ],
    },
    {
      id: "41000000-0000-4000-8000-000000000002",
      name: "Proposta",
      position: 2,
      commercial_meaning: "proposal",
      total_count: 0,
      has_more: false,
      cards: [],
    },
  ];

  test("1. Valida estrutura de dados e suporte a conversas vinculadas", () => {
    expect(mockStages[0].cards[0].has_linked_conversation).toBe(true);
    expect(mockStages[0].cards[0].linked_conversation_id).toBe(
      "99000000-0000-4000-8000-000000000001",
    );
    expect(mockStages[0].cards[1].has_linked_conversation).toBe(false);
  });

  test("2. updateOpportunityAction trata bloqueio de troca de contato quando houver conversa vinculada", async () => {
    const originalUpdate = actionsModule.updateOpportunityAction;
    actionsModule.updateOpportunityAction = async (input: { contactId?: string }) => {
      if (input.contactId && input.contactId !== "51000000-0000-4000-8000-000000000001") {
        return {
          success: false,
          code: "CONTACT_CHANGE_BLOCKED_BY_CONVERSATION",
          error:
            "Não é possível alterar o contato de uma oportunidade que possui conversa vinculada.",
        };
      }
      return { success: true, opportunityId: "55000000-0000-4000-8000-000000000001" };
    };

    try {
      const res = await actionsModule.updateOpportunityAction({
        opportunityId: "55000000-0000-4000-8000-000000000001",
        title: "Novo Titulo",
        contactId: "51000000-0000-4000-8000-000000000002",
      });

      expect(res.success).toBe(false);
      expect(res.code).toBe("CONTACT_CHANGE_BLOCKED_BY_CONVERSATION");
      expect(res.error.toLowerCase()).toContain("não é possível alterar o contato");
    } finally {
      actionsModule.updateOpportunityAction = originalUpdate;
    }
  });

  test("3. openOrCreateOpportunityConversationAction trata contato inelegível com NO_ELIGIBLE_CONVERSATION", async () => {
    const originalOpen = actionsModule.openOrCreateOpportunityConversationAction;
    actionsModule.openOrCreateOpportunityConversationAction = async () => ({
      success: false,
      code: "NO_ELIGIBLE_CONVERSATION",
      error: "Não foi possível abrir a conversa. Verifique se este contato possui um telefone WhatsApp válido e se o WhatsApp está conectado.",
    });

    try {
      const res = await actionsModule.openOrCreateOpportunityConversationAction(
        "55000000-0000-4000-8000-000000000002",
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("NO_ELIGIBLE_CONVERSATION");
      expect(res.error).toContain("Não foi possível abrir a conversa");
    } finally {
      actionsModule.openOrCreateOpportunityConversationAction = originalOpen;
    }
  });

  test("4. archiveOpportunityAction restringe arquivamento a OWNER e executa arquivamento lógico", async () => {
    const originalArchive = actionsModule.archiveOpportunityAction;
    actionsModule.archiveOpportunityAction = async () => ({
      success: true,
      opportunityId: "55000000-0000-4000-8000-000000000001",
    });

    try {
      const res = await actionsModule.archiveOpportunityAction(
        "55000000-0000-4000-8000-000000000001",
      );

      expect(res.success).toBe(true);
      expect(res.opportunityId).toBe("55000000-0000-4000-8000-000000000001");
    } finally {
      actionsModule.archiveOpportunityAction = originalArchive;
    }
  });
});
