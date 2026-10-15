"use server";

import * as serverModule from "@/lib/supabase/server";
import * as adminModule from "@/lib/supabase/admin";
import * as actionsGateway from "@/lib/supabase/gateway-actions";
import { getActiveAccessForAuthUser } from "@/lib/auth/dal";
import { classifyGatewayOutcome } from "@/lib/conversations/gateway-outcome";
import { resolveSendInstance } from "@/lib/conversations/send-instance";
import { describeActionFailure, messageActionErrorText } from "@/lib/conversations/message-action-errors";

// Ações sobre mensagens e conversa: editar, apagar (para todos / para mim), reagir, fixar, buscar e notas internas.
// Padrão de duas fases para o que passa pela Evolution: `begin_*` (com a sessão da pessoa: o banco valida permissão e
// janela) → Evolution → `commit_*` (só o servidor grava). Se a Evolution recusar, nada muda e o motivo volta para a tela.
// Nenhum texto de mensagem, número ou corpo de resposta vai para log: só códigos curtos.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MessageActionResult<T extends object = object> =
  | ({ success: true } & T)
  | { success: false; error: string; code?: string };

type ServerClient = Awaited<ReturnType<typeof serverModule.createServerSupabaseClient>>;

const fail = (error: string, code?: string): { success: false; error: string; code?: string } => ({ success: false, error, code });

async function authorize(): Promise<
  { ok: true; supabase: ServerClient; memberId: string } | { ok: false; result: { success: false; error: string; code?: string } }
> {
  const supabase = await serverModule.createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, result: fail("Sessão expirada ou não autenticada.", "UNAUTHORIZED") };
  const access = await getActiveAccessForAuthUser(data.user.id);
  if (!access) return { ok: false, result: fail("Sessão expirada ou não autenticada.", "UNAUTHORIZED") };
  return { ok: true, supabase, memberId: access.memberId };
}

function logCode(scope: string, code: string) {
  console.error(`Erro em ${scope} (código ${code})`);
}

type BeginInfo = {
  external_message_id?: string;
  recipient_target?: string;
  instance_name?: string | null;
  connection_status?: string | null;
  from_me?: boolean;
  current_emoji?: string | null;
};

// ─── Editar ───────────────────────────────────────────────────────────────────────────────────────

export type EditMessageResult = MessageActionResult<{ text: string; editedAt: string }>;

/** Edita o texto de uma mensagem enviada pelo ImobFlux. O banco valida autoria (ou dono), 15 min e só texto. */
export async function editMessageAction(messageId: string, newText: string): Promise<EditMessageResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(messageId ?? "")) return fail("Mensagem inválida.", "INVALID_INPUT");

    const { data, error } = await auth.supabase.rpc("begin_message_edit", { p_message_id: messageId, p_new_text: newText ?? "" });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    const info = data as unknown as BeginInfo;

    const resolved = resolveSendInstance(info);
    const gatewayResult = resolved.ok
      ? await actionsGateway.editEvolutionMessage(resolved.instance, info.recipient_target, info.external_message_id as string, newText)
      : { success: false as const, code: resolved.code, error: "Instância do WhatsApp indisponível" };
    const outcome = classifyGatewayOutcome(gatewayResult);
    if (!outcome.deliver) {
      logCode("editMessageAction", `${outcome.code}/${gatewayResult.success ? "-" : gatewayResult.code}`);
      return fail(describeActionFailure(outcome, "A mensagem não foi alterada."), outcome.code);
    }

    const admin = adminModule.createAdminSupabaseClient();
    const { data: committed, error: commitError } = await admin.rpc("commit_message_edit", {
      p_message_id: messageId,
      p_new_text: newText,
      p_actor_member_id: auth.memberId,
      p_source: "crm",
    });
    if (commitError) {
      logCode("commit_message_edit", commitError.code ?? "desconhecido");
      return fail("O WhatsApp aceitou a edição, mas não foi possível gravá-la no ImobFlux. Recarregue a conversa.", "COMMIT_ERROR");
    }
    const status = committed as unknown as { edited_at?: string };
    return { success: true, text: newText, editedAt: status.edited_at ?? new Date().toISOString() };
  } catch {
    logCode("editMessageAction", "EXCEPTION");
    return fail("Erro interno ao editar a mensagem.", "INTERNAL_ERROR");
  }
}

// ─── Apagar para todos ────────────────────────────────────────────────────────────────────────────

export type DeleteForEveryoneResult = MessageActionResult<{ deletedAt: string }>;

/** Apaga para todos uma mensagem enviada pelo ImobFlux (WhatsApp + ImobFlux). O original fica só para o dono, em auditoria. */
export async function deleteMessageForEveryoneAction(messageId: string): Promise<DeleteForEveryoneResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(messageId ?? "")) return fail("Mensagem inválida.", "INVALID_INPUT");

    const { data, error } = await auth.supabase.rpc("begin_message_revoke", { p_message_id: messageId });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    const info = data as unknown as BeginInfo;

    const resolved = resolveSendInstance(info);
    const gatewayResult = resolved.ok
      ? await actionsGateway.deleteEvolutionMessageForEveryone(resolved.instance, info.recipient_target, info.external_message_id as string)
      : { success: false as const, code: resolved.code, error: "Instância do WhatsApp indisponível" };
    const outcome = classifyGatewayOutcome(gatewayResult);
    if (!outcome.deliver) {
      logCode("deleteMessageForEveryoneAction", `${outcome.code}/${gatewayResult.success ? "-" : gatewayResult.code}`);
      return fail(describeActionFailure(outcome, "A mensagem não foi apagada."), outcome.code);
    }

    const admin = adminModule.createAdminSupabaseClient();
    const { data: committed, error: commitError } = await admin.rpc("commit_message_revoke", {
      p_message_id: messageId,
      p_actor_member_id: auth.memberId,
      p_source: "crm",
    });
    if (commitError) {
      logCode("commit_message_revoke", commitError.code ?? "desconhecido");
      return fail("O WhatsApp apagou a mensagem, mas não foi possível gravar isso no ImobFlux. Recarregue a conversa.", "COMMIT_ERROR");
    }
    const status = committed as unknown as { deleted_at?: string };
    return { success: true, deletedAt: status.deleted_at ?? new Date().toISOString() };
  } catch {
    logCode("deleteMessageForEveryoneAction", "EXCEPTION");
    return fail("Erro interno ao apagar a mensagem.", "INTERNAL_ERROR");
  }
}

// ─── Apagar para mim (esconder só no ImobFlux) ────────────────────────────────────────────────────

/** Esconde a mensagem no ImobFlux para TODA a equipe. Não toca no WhatsApp. Só o dono restaura. */
export async function hideMessageAction(messageId: string): Promise<MessageActionResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(messageId ?? "")) return fail("Mensagem inválida.", "INVALID_INPUT");
    const { error } = await auth.supabase.rpc("hide_message", { p_message_id: messageId });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    return { success: true };
  } catch {
    logCode("hideMessageAction", "EXCEPTION");
    return fail("Erro interno ao esconder a mensagem.", "INTERNAL_ERROR");
  }
}

export async function restoreHiddenMessageAction(messageId: string): Promise<MessageActionResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(messageId ?? "")) return fail("Mensagem inválida.", "INVALID_INPUT");
    const { error } = await auth.supabase.rpc("restore_hidden_message", { p_message_id: messageId });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    return { success: true };
  } catch {
    logCode("restoreHiddenMessageAction", "EXCEPTION");
    return fail("Erro interno ao restaurar a mensagem.", "INTERNAL_ERROR");
  }
}

// ─── Reagir ───────────────────────────────────────────────────────────────────────────────────────

export type ReactResult = MessageActionResult<{ emoji: string | null }>;

/**
 * Reage a uma mensagem com um emoji. Clicar de novo no mesmo emoji remove a reação; um emoji diferente troca a sua.
 * Só em conversa individual (o banco recusa em grupo). A reação só é gravada depois que a Evolution aceitou.
 */
export async function reactToMessageAction(messageId: string, emoji: string): Promise<ReactResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(messageId ?? "")) return fail("Mensagem inválida.", "INVALID_INPUT");
    const chosen = (emoji ?? "").trim();
    if (!chosen || chosen.length > 16) return fail("Emoji inválido.", "INVALID_INPUT");

    const { data, error } = await auth.supabase.rpc("begin_message_reaction", { p_message_id: messageId, p_emoji: chosen });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    const info = data as unknown as BeginInfo;
    const next = info.current_emoji === chosen ? "" : chosen;

    const resolved = resolveSendInstance(info);
    const gatewayResult = resolved.ok
      ? await actionsGateway.sendEvolutionReaction(resolved.instance, info.recipient_target, info.external_message_id as string, Boolean(info.from_me), next)
      : { success: false as const, code: resolved.code, error: "Instância do WhatsApp indisponível" };
    const outcome = classifyGatewayOutcome(gatewayResult);
    if (!outcome.deliver) {
      logCode("reactToMessageAction", `${outcome.code}/${gatewayResult.success ? "-" : gatewayResult.code}`);
      return fail(describeActionFailure(outcome, "A reação não foi enviada."), outcome.code);
    }

    const admin = adminModule.createAdminSupabaseClient();
    const { error: commitError } = await admin.rpc("commit_message_reaction", {
      p_message_id: messageId,
      p_actor_member_id: auth.memberId,
      p_emoji: next,
    });
    if (commitError) {
      logCode("commit_message_reaction", commitError.code ?? "desconhecido");
      return fail("Não foi possível gravar a reação. Tente de novo.", "COMMIT_ERROR");
    }
    return { success: true, emoji: next || null };
  } catch {
    logCode("reactToMessageAction", "EXCEPTION");
    return fail("Erro interno ao reagir.", "INTERNAL_ERROR");
  }
}

// ─── Fixar conversa ───────────────────────────────────────────────────────────────────────────────

/** Fixa ou desafixa a conversa no topo da lista de quem pede (fixação pessoal, até 5). */
export async function setConversationPinAction(conversationId: string, pinned: boolean): Promise<MessageActionResult<{ pinned: boolean }>> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(conversationId ?? "")) return fail("Conversa inválida.", "INVALID_INPUT");
    const { error } = await auth.supabase.rpc("set_conversation_pin", { p_conversation_id: conversationId, p_pinned: pinned });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    return { success: true, pinned };
  } catch {
    logCode("setConversationPinAction", "EXCEPTION");
    return fail("Erro interno ao fixar a conversa.", "INTERNAL_ERROR");
  }
}

// ─── Buscar na conversa ───────────────────────────────────────────────────────────────────────────

export type ConversationSearchMatch = {
  kind: "message" | "note";
  id: string;
  occurred_at: string;
  snippet: string;
};

export type ConversationSearchResult = MessageActionResult<{ total: number; matches: ConversationSearchMatch[] }>;

/** Busca texto (mensagens, legendas e notas internas) dentro de UMA conversa. A RLS decide o que a pessoa enxerga. */
export async function searchConversationAction(conversationId: string, query: string): Promise<ConversationSearchResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(conversationId ?? "")) return fail("Conversa inválida.", "INVALID_INPUT");
    const term = (query ?? "").trim();
    if (term.length < 2) return { success: true, total: 0, matches: [] };
    const { data, error } = await auth.supabase.rpc("search_conversation_messages", {
      p_conversation_id: conversationId,
      p_query: term.slice(0, 200),
      p_limit: 200,
    });
    if (error) return fail("Não foi possível buscar agora. Tente de novo.", error.code ?? undefined);
    const result = data as unknown as { total: number; matches: ConversationSearchMatch[] };
    return { success: true, total: Number(result.total ?? 0), matches: result.matches ?? [] };
  } catch {
    logCode("searchConversationAction", "EXCEPTION");
    return fail("Erro interno na busca.", "INTERNAL_ERROR");
  }
}

/**
 * Carrega, em ordem, as mensagens até chegar na que a busca achou (a mais antiga ainda não carregada). A tela chama
 * `loadMoreMessagesAction` em lotes; esta função só informa se a mensagem existe na conversa (para não rolar atrás de
 * algo que sumiu). A RLS vale.
 */
export async function messageOccurredAtAction(messageId: string): Promise<{ occurredAt: string | null }> {
  try {
    const auth = await authorize();
    if (!auth.ok || !UUID_REGEX.test(messageId ?? "")) return { occurredAt: null };
    const { data } = await auth.supabase.from("messages").select("occurred_at").eq("id", messageId).maybeSingle();
    return { occurredAt: data?.occurred_at ?? null };
  } catch {
    return { occurredAt: null };
  }
}

// ─── Notas internas ───────────────────────────────────────────────────────────────────────────────

export type ThreadNote = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_member_id: string;
  opportunity_id: string | null;
};

/** Notas internas visíveis da conversa (para mostrar no meio das mensagens). Nunca passam pela Evolution. */
export async function listConversationNotesAction(conversationId: string, opportunityId?: string | null): Promise<ThreadNote[]> {
  try {
    const auth = await authorize();
    if (!auth.ok || !UUID_REGEX.test(conversationId ?? "")) return [];
    const { data, error } = await auth.supabase.rpc("list_conversation_notes", {
      p_conversation_id: conversationId,
      p_opportunity_id: opportunityId && UUID_REGEX.test(opportunityId) ? opportunityId : undefined,
    });
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

/** Só o AUTOR edita a própria nota. */
export async function updateInternalNoteAction(noteId: string, content: string): Promise<MessageActionResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(noteId ?? "")) return fail("Nota inválida.", "INVALID_INPUT");
    const { error } = await auth.supabase.rpc("update_internal_note", { p_note_id: noteId, p_content: content ?? "" });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    return { success: true };
  } catch {
    logCode("updateInternalNoteAction", "EXCEPTION");
    return fail("Erro interno ao editar a nota.", "INTERNAL_ERROR");
  }
}

/** O AUTOR apaga a própria nota; o dono apaga qualquer uma. */
export async function archiveInternalNoteAction(noteId: string): Promise<MessageActionResult> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.result;
    if (!UUID_REGEX.test(noteId ?? "")) return fail("Nota inválida.", "INVALID_INPUT");
    const { error } = await auth.supabase.rpc("archive_internal_note", { p_note_id: noteId });
    if (error) return fail(messageActionErrorText(error), error.code ?? undefined);
    return { success: true };
  } catch {
    logCode("archiveInternalNoteAction", "EXCEPTION");
    return fail("Erro interno ao apagar a nota.", "INTERNAL_ERROR");
  }
}
