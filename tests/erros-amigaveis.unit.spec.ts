import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import { messageActionErrorText, safeErrorCode } from "@/lib/conversations/message-action-errors";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverSupabaseModule = require("@/lib/supabase/server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/conversations/actions");

// As 6 ações de conversa que devolviam `error.message` do banco ao navegador agora devolvem frase em português (por código ou
// categoria) e o log do servidor registra só o código.

const CONVERSATION = "21000000-0000-4000-8000-000000000098";
// Mensagem bruta como o Postgres/Supabase poderia devolver, com dado pessoal e detalhe interno de propósito.
const RAW = 'duplicate key value violates unique constraint "contact_points_pkey" Key (normalized_value)=(+5582988880000) texto: Oi Fulano';

const original = serverSupabaseModule.createServerSupabaseClient;
const originalError = console.error;

function useError(error: { message: string; code?: string }) {
  serverSupabaseModule.createServerSupabaseClient = async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    rpc: async () => ({ data: null, error }),
  });
}

test.describe("mensagens de erro amigáveis nas ações de conversa", () => {
  let logged: string[] = [];
  test.beforeEach(() => {
    logged = [];
    console.error = (...args: unknown[]) => logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  });
  test.afterEach(() => {
    serverSupabaseModule.createServerSupabaseClient = original;
    console.error = originalError;
  });

  const cases: Array<[string, () => Promise<{ success: boolean; error?: string }>]> = [
    ["setConversationArchivedAction", () => actionsModule.setConversationArchivedAction(CONVERSATION, true)],
    ["setGroupTeamVisibilityAction", () => actionsModule.setGroupTeamVisibilityAction(CONVERSATION, true)],
    ["markConversationUnreadAction", () => actionsModule.markConversationUnreadAction(CONVERSATION, true)],
    ["markConversationReadOnOpenAction", () => actionsModule.markConversationReadOnOpenAction(CONVERSATION)],
    ["saveInternalNoteAction", () => actionsModule.saveInternalNoteAction(CONVERSATION, "nota")],
    ["updateQualificationAction", () => actionsModule.updateQualificationAction({ contactId: CONVERSATION, conversationId: CONVERSATION })],
  ];

  for (const [name, run] of cases) {
    test(`${name}: frase em português, sem a mensagem do banco, log só com o código`, async () => {
      useError({ message: RAW, code: "23505" });
      const result = await run();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Isso já existe.");
      expect(result.error).not.toMatch(/duplicate|constraint|5582988880000|Fulano|contact_points/);
      const log = logged.join("\n");
      expect(log).toContain("23505");
      expect(log).not.toMatch(/duplicate|constraint|5582988880000|Fulano|contact_points|texto:/);
    });

    test(`${name}: erro desconhecido cai no texto genérico seguro`, async () => {
      useError({ message: RAW });
      const result = await run();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Não foi possível concluir a ação. Tente de novo.");
      expect(logged.join("\n")).toContain("desconhecido");
      expect(logged.join("\n")).not.toMatch(/duplicate|5582988880000|Fulano/);
    });
  }

  test("código de negócio conhecido vira a frase específica", async () => {
    useError({ message: "group_visibility_not_authorized" });
    expect((await actionsModule.setGroupTeamVisibilityAction(CONVERSATION, true)).error).toBe("Você não tem permissão para alterar a privacidade deste grupo.");
    useError({ message: "conversation_not_available" });
    expect((await actionsModule.setConversationArchivedAction(CONVERSATION, true)).error).toBe("Esta conversa não está disponível.");
    useError({ message: "internal_note_content_empty" });
    expect((await actionsModule.saveInternalNoteAction(CONVERSATION, "")).error).toContain("A nota não pode ficar vazia");
  });

  test("mapeamento por categoria e código seguro de log", () => {
    expect(messageActionErrorText({ message: RAW, code: "42501" })).toBe("Você não tem permissão para fazer isso.");
    expect(messageActionErrorText({ message: RAW, code: "P0002" })).toContain("não foi encontrado");
    expect(messageActionErrorText({ message: RAW, code: "22023" })).toContain("não são válidos");
    expect(safeErrorCode({ code: "23505", message: RAW })).toBe("23505");
    expect(safeErrorCode({ code: "<script>" })).toBe("desconhecido");
    expect(safeErrorCode(new Error(RAW))).toBe("desconhecido");
    expect(safeErrorCode(null)).toBe("desconhecido");
  });
});
