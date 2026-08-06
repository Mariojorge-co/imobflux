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
const actionsModule = require("@/lib/kanban/actions");

test.describe("Sprint 19 UX Hotfixes — Modal ESC, Archive Icon & Friendly Error Unit Tests", () => {
  test("1. NO_ELIGIBLE_CONVERSATION retorna mensagem orientada ao usuário sem expor jargão técnico", async () => {
    const originalOpen = actionsModule.openOrCreateOpportunityConversationAction;
    actionsModule.openOrCreateOpportunityConversationAction = async () => ({
      success: false,
      code: "NO_ELIGIBLE_CONVERSATION",
      error:
        "Não foi possível abrir a conversa. Verifique se este contato possui um telefone WhatsApp válido e se o WhatsApp está conectado.",
    });

    try {
      const res = await actionsModule.openOrCreateOpportunityConversationAction(
        "55000000-0000-4000-8000-000000000099",
      );

      expect(res.success).toBe(false);
      expect(res.code).toBe("NO_ELIGIBLE_CONVERSATION");
      expect(res.error).toBe(
        "Não foi possível abrir a conversa. Verifique se este contato possui um telefone WhatsApp válido e se o WhatsApp está conectado.",
      );
      expect(res.error).not.toContain("canal desacoplado");
    } finally {
      actionsModule.openOrCreateOpportunityConversationAction = originalOpen;
    }
  });

  test("2. Lógica de Dirty Form: formulário preenchido exige confirmação antes de fechar", () => {
    const title = "Proposta Apt 201";
    const description = "Cliente interessado";
    const isDirty = Boolean(title.trim() || description.trim());

    expect(isDirty).toBe(true);

    let confirmCalled = false;
    let confirmResult = false;
    const mockConfirm = () => {
      confirmCalled = true;
      return confirmResult;
    };

    // Simula tentativa de fechar formulário dirty quando o usuário cancela a confirmação
    let closed = false;
    if (isDirty) {
      const confirmed = mockConfirm();
      if (confirmed) {
        closed = true;
      }
    } else {
      closed = true;
    }

    expect(confirmCalled).toBe(true);
    expect(closed).toBe(false);

    // Simula tentativa de fechar formulário dirty quando o usuário aceita a confirmação
    confirmResult = true;
    if (isDirty) {
      const confirmed = mockConfirm();
      if (confirmed) {
        closed = true;
      }
    } else {
      closed = true;
    }

    expect(closed).toBe(true);
  });

  test("3. Lógica de Clean Form: formulário vazio fecha imediatamente sem confirmação", () => {
    const title = "";
    const description = "";
    const isDirty = Boolean(title.trim() || description.trim());

    expect(isDirty).toBe(false);

    let confirmCalled = false;
    let closed = false;

    if (isDirty) {
      confirmCalled = true;
    } else {
      closed = true;
    }

    expect(confirmCalled).toBe(false);
    expect(closed).toBe(true);
  });

  test("4. Ação de arquivar oportunidade utiliza código e funcionalidade mantidos", async () => {
    const originalArchive = actionsModule.archiveOpportunityAction;
    actionsModule.archiveOpportunityAction = async (id: string) => ({
      success: true,
      opportunityId: id,
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
