import "./helpers/server-only";

import { expect, test } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-require-imports */
function stubModule(name: string, exports: object) {
  const path = require.resolve(name);
  require.cache[path] = { id: path, filename: path, loaded: true, exports } as never;
}
let requestHeaders = new Headers();
stubModule("next/headers", { cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => requestHeaders });
stubModule("next/cache", { revalidatePath: () => undefined });

const dal = require("@/lib/auth/dal");
const serverModule = require("@/lib/supabase/server");
const security = require("@/lib/auth/security");
const actions = require("@/app/(app)/configuracoes/equipe/actions") as typeof import("@/app/(app)/configuracoes/equipe/actions");
/* eslint-enable @typescript-eslint/no-require-imports */

let isOwner: boolean;
let originTrusted: boolean;
let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
let rpcResult: { data?: unknown; error?: { message: string } | null };

test.beforeEach(() => {
  requestHeaders = new Headers({ origin: "https://imobflux.test", host: "imobflux.test" });
  isOwner = true;
  originTrusted = true;
  // Módulos compartilhados entre arquivos: a verificação de origem é injetada aqui, não via cabeçalhos.
  security.assertTrustedServerActionOrigin = async () => { if (!originTrusted) throw new Error("origem não confiável"); };
  rpcCalls = [];
  rpcResult = { data: { success: true, status: "removed", ended_conversation_assignments: 0, cleared_opportunities: 0, cleared_tasks: 0 }, error: null };
  dal.requireOwnerAccess = async () => {
    if (!isOwner) throw new Error("forbidden");
    return { role: "owner" };
  };
  serverModule.createServerSupabaseClient = async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return rpcResult; },
  });
});

test.describe("removeMemberAction", () => {
  test("OWNER remove: chama a função do banco com o id certo", async () => {
    const result = await actions.removeMemberAction("member-1");
    expect(result).toEqual({ message: "Funcionário removido.", status: "success" });
    expect(rpcCalls).toEqual([{ fn: "remove_team_member", args: { p_member_id: "member-1" } }]);
  });

  test("informa quantos itens ficaram sem responsável", async () => {
    rpcResult = { data: { success: true, ended_conversation_assignments: 2, cleared_opportunities: 3, cleared_tasks: 1 }, error: null };
    const result = await actions.removeMemberAction("member-1");
    expect(result.status).toBe("success");
    expect(result.message).toContain("6 item(ns) ficaram sem responsável");
  });

  test("quem não é OWNER é recusado sem tocar no banco", async () => {
    isOwner = false;
    const result = await actions.removeMemberAction("member-1");
    expect(result.status).toBe("error");
    expect(rpcCalls).toHaveLength(0);
  });

  test("origem não confiável é recusada sem tocar no banco", async () => {
    originTrusted = false;
    const result = await actions.removeMemberAction("member-1");
    expect(result.status).toBe("error");
    expect(rpcCalls).toHaveLength(0);
  });

  test("erro do banco vira mensagem amigável, sem expor o código técnico", async () => {
    rpcResult = { data: null, error: { message: "team_member_not_removable" } };
    const result = await actions.removeMemberAction("member-1");
    expect(result.status).toBe("error");
    expect(result.message).toContain("não pode ser removido");
    expect(result.message).not.toContain("team_member_not_removable");
  });
});
