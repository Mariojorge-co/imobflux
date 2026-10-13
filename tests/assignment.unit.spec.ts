import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import {
  assignableMembers,
  assignmentErrorMessage,
  formatAssigneeNames,
  type DirectoryMember,
} from "../lib/conversations/assignment";

/* eslint-disable @typescript-eslint/no-require-imports */
require.cache[require.resolve("next/cache")] = {
  id: "next/cache", filename: "next/cache", loaded: true, exports: { revalidatePath: () => undefined },
} as never;
const serverModule = require("@/lib/supabase/server");
const actions = require("@/lib/conversations/actions") as typeof import("@/lib/conversations/actions");
/* eslint-enable @typescript-eslint/no-require-imports */

const CONV = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const BRUNO = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";

const directory: DirectoryMember[] = [
  { member_id: OWNER, display_name: "Dono", role: "owner" },
  { member_id: ANA, display_name: "Ana", role: "attendant" },
  { member_id: BRUNO, display_name: "Bruno", role: "attendant" },
];

test.describe("Atribuição de conversa: regras puras", () => {
  test("opções: exclui quem já é responsável", () => {
    const options = assignableMembers(directory, [{ member_id: ANA, display_name: "Ana" }], "commercial");
    expect(options.map((member) => member.display_name)).toEqual(["Dono", "Bruno"]);
  });

  test("conversa privada ou grupo não liberado: só o proprietário aparece", () => {
    expect(assignableMembers(directory, [], "owner_only").map((member) => member.display_name)).toEqual(["Dono"]);
  });

  test("nomes para a lista: 1, 2 e 3 responsáveis; vazio vira null", () => {
    expect(formatAssigneeNames([{ member_id: ANA, display_name: "Ana" }])).toBe("Ana");
    expect(formatAssigneeNames([{ member_id: ANA, display_name: "Ana" }, { member_id: BRUNO, display_name: "Bruno" }])).toBe("Ana e Bruno");
    expect(formatAssigneeNames([
      { member_id: ANA, display_name: "Ana" }, { member_id: BRUNO, display_name: "Bruno" }, { member_id: OWNER, display_name: "Dono" },
    ])).toBe("Ana, Bruno e Dono");
    expect(formatAssigneeNames([])).toBeNull();
    expect(formatAssigneeNames(undefined)).toBeNull();
    expect(formatAssigneeNames([{ member_id: ANA, display_name: null }])).toBeNull();
  });

  test("erros do banco viram mensagens claras, sem código técnico", () => {
    for (const code of ["conversation_not_available", "assignee_not_active", "assignee_cannot_access_conversation", "assignment_not_found", "assignment_invalid"]) {
      const message = assignmentErrorMessage(`erro: ${code}`);
      expect(message).not.toContain(code);
      expect(message.length).toBeGreaterThan(10);
    }
    expect(assignmentErrorMessage("alguma coisa inesperada")).toContain("Tente novamente");
    expect(assignmentErrorMessage(null)).toContain("Tente novamente");
  });
});

let calls: Array<{ fn: string; args: Record<string, unknown> }>;
let rpcResult: { data: unknown; error: { message: string } | null };

test.describe("Atribuição de conversa: ações", () => {
  test.beforeEach(() => {
    calls = [];
    rpcResult = { data: { success: true, status: "assigned" }, error: null };
    serverModule.createServerSupabaseClient = async () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return rpcResult; },
    });
  });

  test("atribuir chama a função certa com os ids", async () => {
    const result = await actions.assignConversationAction(CONV, ANA);
    expect(result).toEqual({ success: true, status: "assigned" });
    expect(calls).toEqual([{ fn: "assign_conversation", args: { p_conversation_id: CONV, p_member_id: ANA } }]);
  });

  test("remover e trocar chamam as funções corretas", async () => {
    rpcResult = { data: { success: true, status: "unassigned" }, error: null };
    expect((await actions.unassignConversationAction(CONV, ANA)).success).toBe(true);
    rpcResult = { data: { success: true, status: "reassigned" }, error: null };
    expect((await actions.reassignConversationAction(CONV, ANA, BRUNO)).success).toBe(true);
    expect(calls.map((call) => call.fn)).toEqual(["unassign_conversation", "reassign_conversation"]);
    expect(calls[1].args).toEqual({ p_conversation_id: CONV, p_from_member_id: ANA, p_to_member_id: BRUNO });
  });

  test("ids inválidos são recusados antes de tocar no banco", async () => {
    const result = await actions.assignConversationAction("não-é-uuid", ANA);
    expect(result).toEqual({ success: false, error: "Dados inválidos." });
    expect((await actions.reassignConversationAction(CONV, ANA, "x")).success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("erro do banco vira mensagem amigável", async () => {
    rpcResult = { data: null, error: { message: "assignee_cannot_access_conversation" } };
    const result = await actions.assignConversationAction(CONV, ANA);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("restrita ao proprietário");
      expect(result.error).not.toContain("assignee_cannot_access_conversation");
    }
  });

  test("exceção inesperada não vaza", async () => {
    serverModule.createServerSupabaseClient = async () => { throw new Error("boom"); };
    const result = await actions.assignConversationAction(CONV, ANA);
    expect(result.success).toBe(false);
  });
});
