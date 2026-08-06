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
let revalidatePathCalls: string[] = [];
nextCacheModule.revalidatePath = (path: string) => {
  revalidatePathCalls.push(path);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverSupabaseModule = require("@/lib/supabase/server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/kanban/actions");

const originalCreateServerSupabaseClient =
  serverSupabaseModule.createServerSupabaseClient;

test.describe("Sprint 18 — Kanban Server Actions Complete Unit Tests", () => {
  let authUserResult: { user: { id: string } | null } = {
    user: { id: "10000000-0000-4000-8000-000000000001" },
  };
  let rpcCalls: { fnName: string; args: Record<string, unknown> }[] = [];
  let rpcMockResult: { data: unknown; error: unknown } = {
    data: { status: "success" },
    error: null,
  };

  test.beforeEach(() => {
    revalidatePathCalls = [];
    rpcCalls = [];
    authUserResult = { user: { id: "10000000-0000-4000-8000-000000000001" } };
    rpcMockResult = { data: { status: "success" }, error: null };

    serverSupabaseModule.createServerSupabaseClient = async () => {
      return {
        auth: {
          getUser: async () => ({ data: authUserResult, error: null }),
        },
        rpc: async (fnName: string, args: Record<string, unknown>) => {
          rpcCalls.push({ fnName, args });
          return rpcMockResult;
        },
      };
    };
  });

  test.afterEach(() => {
    serverSupabaseModule.createServerSupabaseClient =
      originalCreateServerSupabaseClient;
  });

  test("1. moveOpportunityAction rejeita usuário não autenticado", async () => {
    authUserResult = { user: null };

    const res = await actionsModule.moveOpportunityAction(
      "55000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000002",
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("UNAUTHORIZED");
    expect(res.error).toBe("Sessão não autenticada.");
    expect(rpcCalls.length).toBe(0);
  });

  test("2. moveOpportunityAction rejeita UUIDs inválidos", async () => {
    const res = await actionsModule.moveOpportunityAction(
      "invalid-uuid",
      "41000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000002",
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("VALIDATION_ERROR");
    expect(res.error).toBe("Identificadores inválidos fornecidos.");
    expect(rpcCalls.length).toBe(0);
  });

  test("3. moveOpportunityAction executa movimentação válida com sucesso e chama revalidatePath", async () => {
    rpcMockResult = {
      data: { status: "success", opportunity_id: "55000000-0000-4000-8000-000000000001" },
      error: null,
    };

    const res = await actionsModule.moveOpportunityAction(
      "55000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000002",
      "Cliente confirmou a visita",
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe("success");
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0]).toEqual({
      fnName: "move_opportunity_stage",
      args: {
        p_opportunity_id: "55000000-0000-4000-8000-000000000001",
        p_expected_current_stage_id: "41000000-0000-4000-8000-000000000001",
        p_new_stage_id: "41000000-0000-4000-8000-000000000002",
        p_reason: "Cliente confirmou a visita",
      },
    });
    expect(revalidatePathCalls).toContain("/kanban");
  });

  test("4. moveOpportunityAction com retorno no_change mantém estado", async () => {
    rpcMockResult = {
      data: { status: "no_change", opportunity_id: "55000000-0000-4000-8000-000000000001" },
      error: null,
    };

    const res = await actionsModule.moveOpportunityAction(
      "55000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000001",
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe("no_change");
    expect(revalidatePathCalls).toContain("/kanban");
  });

  test("5. moveOpportunityAction com conflito de concorrência retorna code CONFLICT sem tratar como erro fatal", async () => {
    rpcMockResult = {
      data: {
        status: "conflict",
        message: "A oportunidade foi alterada por outra operação.",
        actual_stage_id: "41000000-0000-4000-8000-000000000003",
      },
      error: null,
    };

    const res = await actionsModule.moveOpportunityAction(
      "55000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000001",
      "41000000-0000-4000-8000-000000000002",
    );

    expect(res.success).toBe(false);
    expect(res.code).toBe("CONFLICT");
    expect(res.error).toBe("A oportunidade foi alterada por outra operação.");
    expect(revalidatePathCalls.length).toBe(0);
  });

  test("6. createOpportunityAction valida título obrigatório", async () => {
    const res = await actionsModule.createOpportunityAction({
      title: "   ",
      contactId: "51000000-0000-4000-8000-000000000001",
      stageId: "41000000-0000-4000-8000-000000000001",
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("O título da oportunidade é obrigatório.");
    expect(rpcCalls.length).toBe(0);
  });

  test("7. createOpportunityAction executa criação com sucesso e chama revalidatePath", async () => {
    rpcMockResult = {
      data: "55000000-0000-4000-8000-000000000099",
      error: null,
    };

    const res = await actionsModule.createOpportunityAction({
      title: "Casa em Condomínio Fechado",
      description: "Interessado em permuta",
      contactId: "51000000-0000-4000-8000-000000000001",
      stageId: "41000000-0000-4000-8000-000000000001",
      responsibleMemberId: "31000000-0000-4000-8000-000000000001",
    });

    expect(res.success).toBe(true);
    expect(res.opportunityId).toBe("55000000-0000-4000-8000-000000000099");
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0]).toEqual({
      fnName: "create_opportunity",
      args: {
        p_contact_id: "51000000-0000-4000-8000-000000000001",
        p_stage_id: "41000000-0000-4000-8000-000000000001",
        p_title: "Casa em Condomínio Fechado",
        p_description: "Interessado em permuta",
        p_responsible_member_id: "31000000-0000-4000-8000-000000000001",
      },
    });
    expect(revalidatePathCalls).toContain("/kanban");
  });
});
