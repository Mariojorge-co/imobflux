import "./helpers/server-only";

import { expect, test } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextCache = require("next/cache");
nextCache.revalidatePath = () => {};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverModule = require("@/lib/supabase/server");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminModule = require("@/lib/supabase/admin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dalModule = require("@/lib/auth/dal");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const messageActions = require("@/lib/conversations/message-actions");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const actionsModule = require("@/lib/conversations/actions");

const MESSAGE = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const NOTE = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";
const JID = "5582988880000@s.whatsapp.net";

type Rpc = { fn: string; args: Record<string, unknown>; as: "user" | "admin" };

const realFetch = globalThis.fetch;
const originalServer = serverModule.createServerSupabaseClient;
const originalAdmin = adminModule.createAdminSupabaseClient;
const originalAccess = dalModule.getActiveAccessForAuthUser;

test.describe("Ações sobre mensagens (servidor)", () => {
  let rpcs: Rpc[] = [];
  let fetches: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  let userResults: Record<string, { data?: unknown; error?: { message: string; code?: string } | null }> = {};
  let evolutionStatus = 201;
  let signedIn = true;

  test.beforeEach(() => {
    process.env.EVOLUTION_API_URL = "http://evolution.test";
    process.env.EVOLUTION_API_KEY = "key";
    process.env.EVOLUTION_INSTANCE_NAME = "inst-env";
    rpcs = [];
    fetches = [];
    userResults = {};
    evolutionStatus = 201;
    signedIn = true;

    serverModule.createServerSupabaseClient = async () => ({
      auth: { getUser: async () => ({ data: { user: signedIn ? { id: "auth-user" } : null }, error: null }) },
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args, as: "user" });
        const result = userResults[fn] ?? { data: { status: "success" } };
        return { data: result.data ?? null, error: result.error ?? null };
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { occurred_at: "2026-10-15T12:00:00Z" } }) }) }) }),
    });
    adminModule.createAdminSupabaseClient = () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcs.push({ fn, args, as: "admin" });
        return { data: { status: "success", edited_at: "2026-10-15T12:05:00Z", deleted_at: "2026-10-15T12:06:00Z" }, error: null };
      },
    });
    dalModule.getActiveAccessForAuthUser = async () => ({ memberId: MEMBER, role: "attendant", workspaceId: "w", appUserId: "a", authUserId: "auth-user", displayName: "Ana" });
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      fetches.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ key: { id: "NEW" } }), { status: evolutionStatus });
    }) as typeof fetch;
  });

  test.afterEach(() => {
    serverModule.createServerSupabaseClient = originalServer;
    adminModule.createAdminSupabaseClient = originalAdmin;
    dalModule.getActiveAccessForAuthUser = originalAccess;
    globalThis.fetch = realFetch;
  });

  const ready = { external_message_id: "EXT-1", recipient_target: JID, instance_name: "inst-1", connection_status: "active" };

  test("editar: o banco valida (begin), a Evolution edita, só então o servidor grava (commit) com o autor logado", async () => {
    userResults.begin_message_edit = { data: ready };
    const result = await messageActions.editMessageAction(MESSAGE, "texto novo");
    expect(result).toMatchObject({ success: true, text: "texto novo", editedAt: "2026-10-15T12:05:00Z" });
    expect(rpcs.map((call) => `${call.as}:${call.fn}`)).toEqual(["user:begin_message_edit", "admin:commit_message_edit"]);
    expect(rpcs[1].args).toEqual({ p_message_id: MESSAGE, p_new_text: "texto novo", p_actor_member_id: MEMBER, p_source: "crm" });
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("http://evolution.test/chat/updateMessage/inst-1");
  });

  test("editar: a Evolution recusa → nada é gravado e o motivo diz que a mensagem não mudou", async () => {
    userResults.begin_message_edit = { data: ready };
    evolutionStatus = 400;
    const result = await messageActions.editMessageAction(MESSAGE, "texto novo");
    expect(result.success).toBe(false);
    expect(result.error).toContain("A mensagem não foi alterada.");
    expect(rpcs.some((call) => call.fn === "commit_message_edit")).toBe(false);
  });

  test("editar: janela vencida, permissão negada e sessão expirada nunca chegam à Evolution", async () => {
    userResults.begin_message_edit = { error: { message: "message_edit_window_expired", code: "22023" } };
    const expired = await messageActions.editMessageAction(MESSAGE, "x");
    expect(expired).toMatchObject({ success: false });
    expect(expired.error).toContain("15 minutos");
    userResults.begin_message_edit = { error: { message: "message_action_not_authorized", code: "42501" } };
    expect((await messageActions.editMessageAction(MESSAGE, "x")).error).toContain("permissão");
    signedIn = false;
    expect((await messageActions.editMessageAction(MESSAGE, "x")).code).toBe("UNAUTHORIZED");
    expect((await messageActions.editMessageAction("nao-e-uuid", "x")).success).toBe(false);
    expect(fetches).toHaveLength(0);
    expect(rpcs.some((call) => call.as === "admin")).toBe(false);
  });

  test("apagar para todos: DELETE na Evolution e só depois o commit; recusa da Evolution não apaga", async () => {
    userResults.begin_message_revoke = { data: ready };
    const ok = await messageActions.deleteMessageForEveryoneAction(MESSAGE);
    expect(ok).toMatchObject({ success: true, deletedAt: "2026-10-15T12:06:00Z" });
    expect(fetches[0]).toMatchObject({ method: "DELETE", body: { id: "EXT-1", remoteJid: JID, fromMe: true } });
    expect(rpcs.map((call) => call.fn)).toEqual(["begin_message_revoke", "commit_message_revoke"]);

    rpcs = [];
    evolutionStatus = 500;
    const refused = await messageActions.deleteMessageForEveryoneAction(MESSAGE);
    expect(refused.success).toBe(false);
    expect(refused.error).toContain("A mensagem não foi apagada.");
    expect(rpcs.some((call) => call.fn === "commit_message_revoke")).toBe(false);
  });

  test("apagar para mim e restaurar: só o banco, a Evolution nunca é chamada", async () => {
    expect((await messageActions.hideMessageAction(MESSAGE)).success).toBe(true);
    expect((await messageActions.restoreHiddenMessageAction(MESSAGE)).success).toBe(true);
    expect(rpcs.map((call) => call.fn)).toEqual(["hide_message", "restore_hidden_message"]);
    expect(fetches).toHaveLength(0);
    userResults.restore_hidden_message = { error: { message: "message_action_not_authorized", code: "42501" } };
    expect((await messageActions.restoreHiddenMessageAction(MESSAGE)).success).toBe(false);
  });

  test("reagir: emoji novo envia o emoji; o mesmo emoji de novo remove (envia vazio); o commit usa o membro logado", async () => {
    userResults.begin_message_reaction = { data: { ...ready, from_me: false, current_emoji: null } };
    const first = await messageActions.reactToMessageAction(MESSAGE, "👍");
    expect(first).toEqual({ success: true, emoji: "👍" });
    expect(fetches[0].body).toMatchObject({ reaction: "👍", key: { id: "EXT-1", fromMe: false, remoteJid: JID } });
    expect(rpcs.at(-1)).toMatchObject({ fn: "commit_message_reaction", args: { p_actor_member_id: MEMBER, p_emoji: "👍" } });

    userResults.begin_message_reaction = { data: { ...ready, from_me: false, current_emoji: "👍" } };
    const second = await messageActions.reactToMessageAction(MESSAGE, "👍");
    expect(second).toEqual({ success: true, emoji: null });
    expect(fetches[1].body.reaction).toBe("");
    expect(rpcs.at(-1)?.args.p_emoji).toBe("");

    userResults.begin_message_reaction = { error: { message: "reaction_not_supported_group", code: "22023" } };
    expect((await messageActions.reactToMessageAction(MESSAGE, "👍")).error).toContain("grupos");
    expect((await messageActions.reactToMessageAction(MESSAGE, "")).success).toBe(false);
    expect((await messageActions.reactToMessageAction(MESSAGE, "x".repeat(17))).success).toBe(false);
  });

  test("fixar: limite de 5 e acesso viram frases claras", async () => {
    expect(await messageActions.setConversationPinAction(CONVERSATION, true)).toEqual({ success: true, pinned: true });
    userResults.set_conversation_pin = { error: { message: "pin_limit_reached", code: "22023" } };
    expect((await messageActions.setConversationPinAction(CONVERSATION, true)).error).toContain("5 conversas");
    expect((await messageActions.setConversationPinAction("x", true)).success).toBe(false);
  });

  test("busca: menos de 2 letras não consulta o banco; o termo é limitado; erro vira frase", async () => {
    expect(await messageActions.searchConversationAction(CONVERSATION, " a ")).toEqual({ success: true, total: 0, matches: [] });
    expect(rpcs).toHaveLength(0);
    userResults.search_conversation_messages = { data: { total: 2, matches: [{ kind: "message", id: "m", occurred_at: "t", snippet: "s" }] } };
    const found = await messageActions.searchConversationAction(CONVERSATION, "ponta verde");
    expect(found).toMatchObject({ success: true, total: 2 });
    expect(rpcs[0].args).toEqual({ p_conversation_id: CONVERSATION, p_query: "ponta verde", p_limit: 200 });
    await messageActions.searchConversationAction(CONVERSATION, "z".repeat(500));
    expect(String(rpcs[1].args.p_query)).toHaveLength(200);
    userResults.search_conversation_messages = { error: { message: "boom", code: "XX000" } };
    expect((await messageActions.searchConversationAction(CONVERSATION, "ponta")).error).toContain("Não foi possível buscar");
  });

  test("nota interna: salvar, editar e apagar NUNCA chamam a Evolution (nem fetch, nem RPC de envio)", async () => {
    userResults.save_internal_note = { data: { note_id: NOTE, note: { id: NOTE, content: "nota", created_at: "t", author_name: "Ana" } } };
    expect(await actionsModule.saveInternalNoteAction(CONVERSATION, "nota")).toMatchObject({ success: true, noteId: NOTE });
    expect((await messageActions.updateInternalNoteAction(NOTE, "nota 2")).success).toBe(true);
    expect((await messageActions.archiveInternalNoteAction(NOTE)).success).toBe(true);
    expect(fetches).toHaveLength(0);
    const names = rpcs.map((call) => call.fn);
    expect(names).toEqual(["save_internal_note", "update_internal_note", "archive_internal_note"]);
    expect(names.some((name) => /queue_outgoing|reconcile_outgoing|ingest_whatsapp|begin_message|commit_message/.test(name))).toBe(false);
    expect(rpcs.every((call) => call.as === "user")).toBe(true);

    userResults.update_internal_note = { error: { message: "note_not_authorized", code: "42501" } };
    expect((await messageActions.updateInternalNoteAction(NOTE, "x")).error).toContain("permissão");
    userResults.archive_internal_note = { error: { message: "note_not_authorized", code: "42501" } };
    expect((await messageActions.archiveInternalNoteAction(NOTE)).error).toContain("permissão");
  });
});
