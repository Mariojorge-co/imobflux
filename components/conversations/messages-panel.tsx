"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowLeft, EyeOff, Info, Mail, Pin, PinOff, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createOpportunityFromConversationAction,
  loadMoreMessagesAction,
  markConversationReadOnOpenAction,
  markConversationUnreadAction,
  refreshConversationMessagesAction,
  refreshVisibleInternalNotesAction,
  setConversationArchivedAction,
  setGroupTeamVisibilityAction,
} from "@/lib/conversations/actions";
import {
  archiveInternalNoteAction,
  deleteMessageForEveryoneAction,
  editMessageAction,
  hideMessageAction,
  listConversationNotesAction,
  reactToMessageAction,
  searchConversationAction,
  setConversationPinAction,
  updateInternalNoteAction,
  type ConversationSearchMatch,
  type ThreadNote,
} from "@/lib/conversations/message-actions";
import { MessageForm } from "@/components/conversations/message-form";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { NoteBubble } from "@/components/conversations/note-bubble";
import { ForwardDialog } from "@/components/conversations/forward-dialog";
import { ConversationSearch } from "@/components/conversations/conversation-search";
import { HiddenMessagesDialog, MessageHistoryDialog } from "@/components/conversations/message-audit-dialogs";
import { ConfirmDialog } from "@/components/quick-replies/confirm-dialog";
import { Button, Drawer, Input, ModalDialog } from "@/components/ui";
import { SlaBadge } from "@/components/conversations/sla-badge";
import { SlaControl, type SlaMode } from "@/components/conversations/sla-control";
import { resolveOpportunityTargets } from "@/lib/conversations/opportunity-targets";
import { copyableText, quoteAuthorLabel, snapshotFromMessage, type Viewer } from "@/lib/conversations/message-ui";
import type { ReplyRef } from "@/lib/conversations/message-merge";
import type {
  ConversationContextData,
  ConversationListItem,
  ConversationMessage,
  ConversationPipelineStage,
  LinkedOpportunityInfo,
  MessagesCursor,
} from "@/lib/conversations/data";
import { moveOpportunityAction } from "@/lib/kanban/actions";
import { ClientContextPanel } from "@/components/conversations/client-context-panel";
import { AssigneesBar } from "@/components/conversations/assignees-bar";
import type { ConversationAssignee, DirectoryMember } from "@/lib/conversations/assignment";
import { emitConversationClientUpdate } from "@/lib/conversations/client-events";
import { useOutgoingFiles } from "@/components/conversations/use-outgoing-files";
import { useFileDrop } from "@/components/conversations/use-file-drop";
import { failPendingMessage, isDismissedFailure, isPendingMessage, mergeMessages, removePendingMessage, type DismissedFailure } from "@/lib/conversations/message-merge";
import { retryMediaQueued, sendTextQueued } from "@/lib/conversations/send-client";
import { conversationHasSla, conversationPatchFromMessage, isConversationClosed, pickSlaMessage } from "@/lib/conversations/sla-display";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type MessagesPanelProps = {
  conversation: ConversationListItem;
  initialHasOlder: boolean;
  initialMessages: ConversationMessage[];
  linkedOpportunity?: LinkedOpportunityInfo | null;
  initialSelectedOpportunityId?: string;
  context?: ConversationContextData | null;
  opportunityContexts?: ConversationContextData[];
  stages?: ConversationPipelineStage[];
  /** Se verdadeiro, renderiza o botão "Voltar" (mobile). */
  showBackButton?: boolean;
  canManagePrivacy?: boolean;
  assignees?: ConversationAssignee[];
  members?: DirectoryMember[];
  /** Quem está logado (membro e papel): base das permissões de editar, apagar e notas na tela. */
  viewer?: Viewer | null;
};

export function MessagesPanel({
  conversation,
  initialHasOlder,
  initialMessages,
  linkedOpportunity,
  initialSelectedOpportunityId,
  context,
  opportunityContexts = [],
  stages = [],
  showBackButton = false,
  canManagePrivacy = false,
  assignees = [],
  members = [],
  viewer = null,
}: MessagesPanelProps) {
  const [, startTransition] = useTransition();
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages);
  // Ações sobre mensagens (responder, editar, apagar, encaminhar) e notas no meio da conversa.
  const [replyTo, setReplyTo] = useState<(ReplyRef & { author: string }) | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ConversationMessage | null>(null);
  const [historyTarget, setHistoryTarget] = useState<string | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: "hide" | "delete"; message: ConversationMessage } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [threadNotes, setThreadNotes] = useState<ThreadNote[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Busca dentro da conversa.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<ConversationSearchMatch[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSeeking, setSearchSeeking] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [liveConversation, setLiveConversation] = useState(conversation);
  const [dismissedFailed, setDismissedFailed] = useState<ReadonlyArray<DismissedFailure>>([]);
  const outgoing = useOutgoingFiles(conversation.conversation_id);
  const dropZone = useFileDrop({ enabled: conversation.conversation_type !== "group", onFiles: (files) => void outgoing.addFiles(files) });
  const visibleMessages = useMemo(() => messages.filter((message) => !isDismissedFailure(message, dismissedFailed)), [messages, dismissedFailed]);
  const highlightTerm = searchOpen && searchQuery.trim().length >= 2 ? searchQuery.trim() : undefined;
  // Mensagens e notas internas na mesma linha do tempo. As notas NÃO entram em `messages` (prazo, rascunho e envio nunca
  // as veem): só aparecem aqui, na hora de desenhar.
  const timeline = useMemo(() => buildTimeline(visibleMessages, threadNotes), [visibleMessages, threadNotes]);
  const [optimisticNotes, setOptimisticNotes] = useState<
    Record<string, ConversationContextData["notes"]>
  >({});
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(initialHasOlder);
  const [isCreateOppOpen, setIsCreateOppOpen] = useState(false);
  const [oppTitle, setOppTitle] = useState("");
  const [oppError, setOppError] = useState<string | null>(null);
  const [isCreatingOpp, setIsCreatingOpp] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(
    opportunityContexts.some((item) => item.active_opportunity?.opportunity_id === initialSelectedOpportunityId)
      ? initialSelectedOpportunityId!
      : context?.active_opportunity?.opportunity_id
      ?? opportunityContexts[0]?.active_opportunity?.opportunity_id
      ?? null,
  );
  const [optimisticStages, setOptimisticStages] = useState<Record<string, string>>({});

  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollHeightRef = useRef(0);
  const pendingScrollAdjustmentRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const shouldAutoReadRef = useRef(Boolean(conversation.is_unread));
  const pendingScrollToBottomRef = useRef(false);
  // Espelhos em ref (para laços assíncronos) e o conjunto de mensagens que o servidor já devolveu: só estas podem
  // sumir da tela quando deixam de vir (escondidas por outra pessoa); uma mensagem recém-enviada nunca some por engano.
  // Marca a coluna da conversa como "pronta" quando a página terminou de hidratar (os cliques só valem depois disso).
  const columnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    columnRef.current?.setAttribute("data-ready", "true");
  }, []);
  const messagesRef = useRef<ConversationMessage[]>(initialMessages);
  const hasOlderRef = useRef(initialHasOlder);
  const seenServerIdsRef = useRef(new Set(initialMessages.map((message) => message.id)));
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    hasOlderRef.current = hasOlder;
  }, [hasOlder]);

  const selectedContextBase = opportunityContexts.find(
    (item) => item.active_opportunity?.opportunity_id === selectedOpportunityId,
  ) ?? opportunityContexts[0] ?? context;
  const activeOpp = selectedContextBase?.active_opportunity || (linkedOpportunity ? {
    opportunity_id: linkedOpportunity.opportunity_id,
    title: linkedOpportunity.title,
    current_stage_id: linkedOpportunity.current_stage_id,
  } : null);
  const displayedStageId = activeOpp
    ? optimisticStages[activeOpp.opportunity_id] ?? activeOpp.current_stage_id
    : null;

  const effectiveOpportunityId =
    selectedContextBase?.active_opportunity?.opportunity_id ?? selectedOpportunityId;
  const noteContextKey = effectiveOpportunityId ?? "general";
  const optimisticNotesForContext = optimisticNotes[noteContextKey] ?? [];
  const selectedContext = selectedContextBase && optimisticNotesForContext.length > 0
    ? appendNotesToContext(selectedContextBase, optimisticNotesForContext)
    : selectedContextBase;

  useEffect(() => {
    if (!shouldAutoReadRef.current) return;
    shouldAutoReadRef.current = false;

    startTransition(async () => {
      const result = await markConversationReadOnOpenAction(
        conversation.conversation_id,
      );
      if (!result.success) return;

      setLiveConversation((previous) => ({ ...previous, is_unread: false }));
      emitConversationClientUpdate({
        conversationId: conversation.conversation_id,
        isUnread: false,
      });
    });
  }, [conversation.conversation_id, router]);

  // Auto-scroll para a mensagem mais recente no primeiro carregamento
  useEffect(() => {
    if (listRef.current && !hasAutoScrolledRef.current && initialMessages.length > 0) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      hasAutoScrolledRef.current = true;
    }
  }, [initialMessages]);

  useLayoutEffect(() => {
    const pending = pendingScrollAdjustmentRef.current;
    const list = listRef.current;
    if (!pending || !list) return;

    list.scrollTop = pending.scrollTop + (list.scrollHeight - pending.scrollHeight);
    pendingScrollAdjustmentRef.current = null;
  }, [messages]);

  useLayoutEffect(() => {
    if (!pendingScrollToBottomRef.current || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
    pendingScrollToBottomRef.current = false;
  }, [messages]);

  // Fica no final enquanto o usuário não rolou para cima: fotos e figurinhas carregam depois e aumentam a altura.
  useEffect(() => {
    const content = contentRef.current;
    const list = listRef.current;
    if (!content || !list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) list.scrollTop = list.scrollHeight;
      lastScrollHeightRef.current = list.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const handleLogScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    // Se a altura mudou desde a última medição (foto carregou), a distância ao final cresceu por causa da mídia e não
    // porque o usuário rolou: ignora este evento (o ResizeObserver cuida de manter no final).
    if (list.scrollHeight !== lastScrollHeightRef.current) {
      lastScrollHeightRef.current = list.scrollHeight;
      return;
    }
    stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  }, []);

  const handleMessagePersisted = useCallback((message: ConversationMessage) => {
    stickToBottomRef.current = true;
    pendingScrollToBottomRef.current = true;
    setMessages((previous) => mergeMessages(previous, [message]));

    setLiveConversation((previous) => ({
      ...previous,
      last_activity_at: message.occurred_at,
      last_msg_direction: message.direction,
      last_msg_occurred_at: message.occurred_at,
      last_msg_text: message.text_content,
      ...conversationPatchFromMessage(previous, message),
      is_unread: false,
    }));
    emitConversationClientUpdate({
      conversationId: conversation.conversation_id,
      isUnread: false,
      message,
    });
  }, [conversation.conversation_id]);

  // Bolha provisória: aparece na hora ("enviando…") e sai quando o envio termina (sucesso ou falha).
  const handleMessageSending = useCallback((pending: ConversationMessage) => {
    stickToBottomRef.current = true;
    pendingScrollToBottomRef.current = true;
    setMessages((previous) => mergeMessages(previous, [pending]));
  }, []);

  const handleMessageSettled = useCallback((pendingId: string, persisted?: ConversationMessage) => {
    setMessages((previous) => removePendingMessage(previous, pendingId));
    if (persisted) handleMessagePersisted(persisted);
  }, [handleMessagePersisted]);

  // Prazo da conversa mudou (pausa/desativação/reativação): cabeçalho e lista se atualizam na hora, sem recarregar.
  const handleSlaChanged = useCallback((result: { sla_mode: SlaMode; sla_paused_at: string | null; sla_applies: boolean }) => {
    const base = result.sla_applies ? pickSlaMessage(messages) : null;
    const sla = {
      sla_mode: result.sla_mode,
      sla_paused_at: result.sla_paused_at,
      sla_applies: result.sla_applies,
      sla_direction: base?.direction ?? null,
      sla_at: base?.occurred_at ?? null,
    };
    setLiveConversation((previous) => ({ ...previous, ...sla }));
    emitConversationClientUpdate({ conversationId: conversation.conversation_id, sla });
  }, [conversation.conversation_id, messages]);

  // Falhou: a bolha continua na conversa como "não enviada", com o motivo e "Tentar de novo".
  const handleMessageFailed = useCallback((pendingId: string, reason: string, _code?: string, persisted?: ConversationMessage) => {
    setMessages((previous) => {
      const failed = failPendingMessage(previous, pendingId, reason);
      // Arquivo: o servidor já gravou a mensagem como "falhou"; ela substitui a provisória (o "tentar de novo" usa o id real).
      return persisted ? mergeMessages(removePendingMessage(failed, pendingId), [{ ...persisted, send_error: reason }]) : failed;
    });
  }, []);

  // "Tentar de novo" é uma NOVA mensagem (nova chave) na fila da conversa; a que falhou sai da tela. Nada é reenviado sozinho.
  const handleRetryMessage = useCallback((failed: ConversationMessage) => {
    const text = failed.text_content?.trim();
    if (!text) return;
    setDismissedFailed((previous) => [...previous, { id: failed.id, text, at: failed.occurred_at }]);
    const handlers = { onSending: handleMessageSending, onSettled: handleMessageSettled, onFailed: handleMessageFailed };
    if (failed.has_attachments) void retryMediaQueued(conversation.conversation_id, failed, handlers);
    else void sendTextQueued(conversation.conversation_id, text, handlers);
  }, [conversation.conversation_id, handleMessageFailed, handleMessageSending, handleMessageSettled]);

  // Falha que nem chegou a ser gravada (ex.: arquivo recusado no servidor): só dá para tirar a bolha da conversa.
  const handleDiscardFailed = useCallback((failed: ConversationMessage) => {
    setMessages((previous) => removePendingMessage(previous, failed.id));
  }, []);

  const handleInternalNoteSaved = useCallback((
    note: ConversationContextData["notes"][number],
    savedOpportunityId: string | null,
  ) => {
    const savedContextKey = savedOpportunityId ?? "general";
    setOptimisticNotes((previous) => ({
      ...previous,
      [savedContextKey]: [
        note,
        ...(previous[savedContextKey] ?? []).filter(
          (existing) => existing.id !== note.id,
        ),
      ],
    }));
  }, []);

  const handleContactUpdated = useCallback((displayName: string) => {
    setLiveConversation((previous) => ({ ...previous, participant_name: displayName }));
    emitConversationClientUpdate({
      conversationId: conversation.conversation_id,
      participantName: displayName,
    });
  }, [conversation.conversation_id]);

  const reconcileVisibleNotes = useCallback(async () => {
    const notes = await refreshVisibleInternalNotesAction(
      conversation.conversation_id,
      effectiveOpportunityId,
    );
    setOptimisticNotes((previous) => ({ ...previous, [noteContextKey]: notes }));
    // As mesmas notas aparecem no meio da conversa.
    setThreadNotes(await listConversationNotesAction(conversation.conversation_id, effectiveOpportunityId));
  }, [conversation.conversation_id, effectiveOpportunityId, noteContextKey]);

  // Carrega o lote de mensagens mais antigo. Usa refs para poder ser chamado em laço (busca até achar uma mensagem antiga).
  const loadOlderPromiseRef = useRef<Promise<string[]> | null>(null);
  // Cursor da mensagem mais antiga que o servidor já entregou: atualizado na hora (sem esperar a tela redesenhar), para que
  // dois pedidos seguidos nunca usem o mesmo cursor.
  const oldestCursorRef = useRef<MessagesCursor | null>(
    initialMessages[0] ? { occurred_at: initialMessages[0].occurred_at, id: initialMessages[0].id } : null,
  );
  const loadOlderBatch = useCallback(async (): Promise<string[]> => {
    const oldest = messagesRef.current.find((message) => !isPendingMessage(message));
    const cursor: MessagesCursor | null = oldestCursorRef.current ?? (oldest ? { occurred_at: oldest.occurred_at, id: oldest.id } : null);
    if (!cursor) {
      hasOlderRef.current = false;
      setHasOlder(false);
      return [];
    }

    setIsLoadingOlder(true);
    try {
      const page = await loadMoreMessagesAction(
        conversation.conversation_id,
        cursor,
      );
      const existingIds = new Set(messagesRef.current.map((message) => message.id));
      const uniqueOlder = page.messages.filter((message) => !existingIds.has(message.id));
      for (const message of page.messages) seenServerIdsRef.current.add(message.id);
      if (page.messages[0]) oldestCursorRef.current = { occurred_at: page.messages[0].occurred_at, id: page.messages[0].id };

      if (uniqueOlder.length > 0 && listRef.current) {
        pendingScrollAdjustmentRef.current = {
          scrollHeight: listRef.current.scrollHeight,
          scrollTop: listRef.current.scrollTop,
        };
      }

      setMessages((previous) => {
        const currentIds = new Set(previous.map((message) => message.id));
        return [
          ...uniqueOlder.filter((message) => !currentIds.has(message.id)),
          ...previous,
        ];
      });
      const more = page.hasMore && uniqueOlder.length > 0;
      hasOlderRef.current = more;
      setHasOlder(more);
      return page.messages.map((message) => message.id);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [conversation.conversation_id]);

  // Um lote por vez: quem pedir enquanto outro lote carrega espera o MESMO lote (não devolve cedo sem ter carregado nada).
  const handleLoadOlder = useCallback((): Promise<string[]> => {
    if (loadOlderPromiseRef.current) return loadOlderPromiseRef.current;
    const run = loadOlderBatch().finally(() => {
      loadOlderPromiseRef.current = null;
    });
    loadOlderPromiseRef.current = run;
    return run;
  }, [loadOlderBatch]);

  // ─── Ações sobre mensagens ──────────────────────────────────────────────────────────────────────

  const patchMessage = useCallback((id: string, patch: Partial<ConversationMessage>) => {
    setMessages((previous) => previous.map((message) => (message.id === id ? { ...message, ...patch } : message)));
  }, []);

  const handleReply = useCallback((message: ConversationMessage) => {
    const snapshot = snapshotFromMessage(message, liveConversation.participant_name);
    setEditing(null);
    setReplyTo({ messageId: message.id, snapshot, author: quoteAuthorLabel(snapshot, viewer) });
  }, [liveConversation.participant_name, viewer]);

  const handleStartEdit = useCallback((message: ConversationMessage) => {
    setReplyTo(null);
    setEditing({ id: message.id, text: message.text_content ?? "" });
  }, []);

  const handleSaveEdit = useCallback(async (id: string, text: string): Promise<{ success: boolean; error?: string }> => {
    const result = await editMessageAction(id, text);
    if (!result.success) return { success: false, error: result.error };
    patchMessage(id, { text_content: result.text, edited_at: result.editedAt, wa_pending_action: result.pending ? "edit" : null });
    setEditing(null);
    return { success: true };
  }, [patchMessage]);

  const handleReact = useCallback(async (message: ConversationMessage, emoji: string) => {
    const result = await reactToMessageAction(message.id, emoji);
    if (!result.success) {
      setActionNotice(result.error);
      return;
    }
    setMessages((previous) =>
      previous.map((item) => {
        if (item.id !== message.id) return item;
        const others = (item.reactions ?? []).filter((reaction) => !reaction.mine);
        return {
          ...item,
          reactions: result.emoji
            ? [...others, { emoji: result.emoji, by: "member" as const, mine: true, name: null }]
            : others,
        };
      }),
    );
  }, []);

  const handleCopy = useCallback((message: ConversationMessage) => {
    const text = copyableText(message);
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => setActionNotice("Não foi possível copiar o texto."));
  }, []);

  const [confirmError, setConfirmError] = useState<string | null>(null);
  const runConfirmedAction = useCallback(async () => {
    if (!confirmAction) return;
    const { kind, message } = confirmAction;
    setConfirmBusy(true);
    setConfirmError(null);
    const result = kind === "hide" ? await hideMessageAction(message.id) : await deleteMessageForEveryoneAction(message.id);
    setConfirmBusy(false);
    if (!result.success) {
      setConfirmError(result.error);
      return;
    }
    if (kind === "hide") {
      setMessages((previous) => previous.filter((item) => item.id !== message.id));
    } else {
      patchMessage(message.id, {
        deleted_at: "deletedAt" in result ? String(result.deletedAt) : new Date().toISOString(),
        deleted_source: "crm",
        wa_pending_action: "revoke",
        text_content: null,
        has_attachments: false,
        attachments: [],
        reactions: [],
      });
    }
    if (replyTo?.messageId === message.id) setReplyTo(null);
    if (editing?.id === message.id) setEditing(null);
    setConfirmAction(null);
  }, [confirmAction, editing, patchMessage, replyTo]);

  // ─── Notas internas no meio da conversa ─────────────────────────────────────────────────────────

  const refreshThreadNotes = useCallback(async () => {
    const notes = await listConversationNotesAction(conversation.conversation_id, effectiveOpportunityId);
    setThreadNotes(notes);
  }, [conversation.conversation_id, effectiveOpportunityId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshThreadNotes(), 0);
    return () => window.clearTimeout(timer);
  }, [refreshThreadNotes]);

  const handleNoteEdit = useCallback(async (noteId: string, content: string) => {
    const result = await updateInternalNoteAction(noteId, content);
    if (result.success) await refreshThreadNotes();
    return result.success ? { success: true } : { success: false, error: result.error };
  }, [refreshThreadNotes]);

  const handleNoteDelete = useCallback(async (noteId: string) => {
    const result = await archiveInternalNoteAction(noteId);
    if (result.success) {
      setThreadNotes((previous) => previous.filter((note) => note.id !== noteId));
      void reconcileVisibleNotes();
    }
    return result.success ? { success: true } : { success: false, error: result.error };
  }, [reconcileVisibleNotes]);

  // ─── Rolar até uma mensagem (citação e busca) ───────────────────────────────────────────────────

  // Cada pedido de rolagem cancela o anterior (digitar "es", "esc"… dispara várias buscas seguidas; só a última vale).
  const revealTokenRef = useRef(0);
  const revealTarget = useCallback(async (kind: "message" | "note", id: string): Promise<"found" | "missing" | "cancelled"> => {
    const token = ++revealTokenRef.current;
    const selector = kind === "note" ? `[data-note-id="${id}"]` : `[data-message-id="${id}"]`;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const element = listRef.current?.querySelector(selector);
      if (element) {
        stickToBottomRef.current = false;
        element.scrollIntoView({ block: "center" });
        setSearchSeeking(false);
        setHighlightedId(id);
        window.setTimeout(() => setHighlightedId((current) => (current === id ? null : current)), 2200);
        return "found";
      }
      if (!hasOlderRef.current) break;
      setSearchSeeking(true);
      const loaded = await handleLoadOlder();
      // Espera o React desenhar o lote carregado: se a mensagem procurada veio neste lote, espera até 3 s por ela na tela;
      // senão, só dois quadros (o próximo lote é pedido em seguida).
      const arrived = kind === "message" && loaded.includes(id);
      for (let frame = 0; frame < (arrived ? 60 : 2); frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        if (arrived && listRef.current?.querySelector(selector)) break;
      }
      if (token !== revealTokenRef.current) return "cancelled";
    }
    if (token !== revealTokenRef.current) return "cancelled";
    setSearchSeeking(false);
    return "missing";
  }, [handleLoadOlder]);

  const handleJumpToQuoted = useCallback(async (messageId: string) => {
    const found = await revealTarget("message", messageId);
    if (found === "missing") setActionNotice("A mensagem original não está mais disponível nesta conversa.");
  }, [revealTarget]);

  // ─── Busca na conversa ──────────────────────────────────────────────────────────────────────────

  const goToMatch = useCallback(async (matches: ConversationSearchMatch[], index: number) => {
    const match = matches[index];
    if (!match) return;
    setSearchIndex(index);
    const found = await revealTarget(match.kind, match.id);
    if (found === "cancelled") return;
    setSearchError(found === "missing" ? "Esta mensagem não está mais disponível." : null);
  }, [revealTarget]);

  useEffect(() => {
    if (!searchOpen) return;
    const term = searchQuery.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      void (async () => {
        const result = await searchConversationAction(conversation.conversation_id, term);
        if (cancelled) return;
        setSearchLoading(false);
        if (!result.success) {
          setSearchError(result.error);
          setSearchMatches([]);
          setSearchTotal(0);
          setSearchIndex(-1);
          return;
        }
        setSearchError(null);
        setSearchMatches(result.matches);
        setSearchTotal(result.total);
        if (result.matches.length > 0) void goToMatch(result.matches, 0);
        else setSearchIndex(-1);
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchQuery, conversation.conversation_id, goToMatch]);

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (value.trim().length < 2) {
      setSearchMatches([]);
      setSearchTotal(0);
      setSearchIndex(-1);
      setSearchError(null);
      setSearchLoading(false);
    }
  }, []);

  const closeSearch = useCallback(() => {
    revealTokenRef.current += 1; // cancela qualquer rolagem em andamento
    setSearchSeeking(false);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setSearchTotal(0);
    setSearchIndex(-1);
    setSearchError(null);
    setHighlightedId(null);
  }, []);

  const handleTogglePin = () => {
    startTransition(async () => {
      const next = !liveConversation.is_pinned;
      const result = await setConversationPinAction(conversation.conversation_id, next);
      if (!result.success) {
        setActionNotice(result.error);
        return;
      }
      setLiveConversation((previous) => ({ ...previous, is_pinned: next }));
      emitConversationClientUpdate({ conversationId: conversation.conversation_id, isPinned: next });
    });
  };

  const handleStageSelect = (newStageId: string) => {
    if (!activeOpp) return;
    startTransition(async () => {
      const result = await moveOpportunityAction(
        activeOpp.opportunity_id,
        activeOpp.current_stage_id,
        newStageId,
        "Alterado via seletor de etapa da conversa",
      );
      if (result.success) {
        setOptimisticStages((previous) => ({ ...previous, [activeOpp.opportunity_id]: newStageId }));
        router.refresh();
      }
    });
  };

  const handleToggleUnread = () => {
    startTransition(async () => {
      const nextUnread = !liveConversation.is_unread;
      const result = await markConversationUnreadAction(
        conversation.conversation_id,
        nextUnread,
      );
      if (!result.success) return;
      setLiveConversation((previous) => ({ ...previous, is_unread: nextUnread }));
      emitConversationClientUpdate({
        conversationId: conversation.conversation_id,
        isUnread: nextUnread,
      });
    });
  };

  const handleArchive = async () => {
    const archived = !liveConversation.archived_at;
    const result = await setConversationArchivedAction(
      conversation.conversation_id,
      archived,
    );
    if (!result.success) return;
    if (archived) router.push("/conversas");
    else {
      setLiveConversation((previous) => ({ ...previous, archived_at: null }));
      router.refresh();
    }
  };

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    let realtimeReady = false;
    const reconcileMessages = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          const page = await refreshConversationMessagesAction(conversation.conversation_id);
          if (disposed) return;
          // Some da tela o que o servidor já tinha devolvido e agora não devolve mais (mensagem escondida por outra pessoa).
          const pageIds = new Set(page.messages.map((message) => message.id));
          const oldestInPage = page.messages[0]?.occurred_at;
          const vanished = new Set(
            messagesRef.current
              .filter(
                (message) =>
                  seenServerIdsRef.current.has(message.id)
                  && !pageIds.has(message.id)
                  && (!page.hasMore || (oldestInPage !== undefined && message.occurred_at >= oldestInPage)),
              )
              .map((message) => message.id),
          );
          for (const id of pageIds) seenServerIdsRef.current.add(id);
          setMessages((previous) => mergeMessages(vanished.size > 0 ? previous.filter((message) => !vanished.has(message.id)) : previous, page.messages));
          const newest = page.messages.at(-1);
          if (newest) {
            setLiveConversation((previous) => ({
              ...previous,
              last_activity_at: newest.occurred_at,
              last_msg_direction: newest.direction,
              last_msg_occurred_at: newest.occurred_at,
              last_msg_text: newest.text_content,
              ...conversationPatchFromMessage(previous, newest),
            }));
            emitConversationClientUpdate({
              conversationId: conversation.conversation_id,
              message: newest,
            });
            if (newest.direction === "incoming") {
              await markConversationReadOnOpenAction(conversation.conversation_id);
              emitConversationClientUpdate({
                conversationId: conversation.conversation_id,
                isUnread: false,
              });
            }
          }
        })();
      }, 60);
    };
    const channel = supabase
      .channel(`authorized-messages-${conversation.conversation_id}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.conversation_id}`,
        },
        reconcileMessages,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "internal_notes",
          filter: `conversation_id=eq.${conversation.conversation_id}`,
        },
        () => {
          if (noteTimer) clearTimeout(noteTimer);
          noteTimer = setTimeout(() => void reconcileVisibleNotes(), 80);
        },
      )
      .subscribe((status) => {
        realtimeReady = status === "SUBSCRIBED";
        if (realtimeReady) reconcileMessages();
      });
    // Rede de segurança: com o Realtime conectado, confere a cada 15 s (antes: a cada 2 s, o que mantinha ações
    // do servidor em andamento o tempo todo e disputava a fila com a troca de conversa); sem Realtime, a cada 2 s.
    let pollingTimer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      reconcileMessages();
      void reconcileVisibleNotes();
      pollingTimer = setTimeout(poll, realtimeReady ? 15_000 : 2_000);
    };
    pollingTimer = setTimeout(poll, 2_000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (noteTimer) clearTimeout(noteTimer);
      if (pollingTimer) clearTimeout(pollingTimer);
      void supabase.removeChannel(channel);
    };
  }, [conversation.conversation_id, reconcileVisibleNotes]);

  const handleCreateOpportunitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oppTitle.trim()) return;

    setOppError(null);
    const targets = resolveOpportunityTargets(stages, context?.contact?.id);
    if (!targets.ok) {
      setOppError(targets.error);
      return;
    }

    setIsCreatingOpp(true);

    const res = await createOpportunityFromConversationAction({
      conversationId: conversation.conversation_id,
      contactId: targets.contactId,
      stageId: targets.stageId,
      title: oppTitle.trim(),
    });

    setIsCreatingOpp(false);

    if (res.success) {
      setIsCreateOppOpen(false);
      setOppTitle("");
      router.push(`/kanban?opportunityId=${res.opportunityId}`);
    } else {
      setOppError(res.error || "Falha ao criar oportunidade.");
    }
  };

  const displayName =
    conversation.participant_name ?? "Participante desconhecido";
  const displayPhone = conversation.participant_phone || context?.contact?.phone;
  const isGroup = conversation.conversation_type === "group";

  return (
    <div className="flex h-full min-w-0 w-full overflow-hidden">
      {/* Coluna Principal da Conversa (também é a área de soltar arquivos) */}
      <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background" data-testid="conversation-column" ref={columnRef} {...dropZone.handlers}>
        {dropZone.dragging ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10"
            data-testid="drop-overlay"
          >
            <p className="rounded-card bg-surface px-4 py-2 text-body font-semibold text-primary shadow-lg">Solte os arquivos para anexar</p>
          </div>
        ) : null}
        {/* Cabeçalho do painel de mensagens */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-3 py-1.5 sm:px-4" data-testid="conversation-header">
          <div className="flex min-w-0 flex-1 basis-48 items-center gap-2 sm:gap-3">
            {showBackButton && (
              <Link
                aria-label="Voltar para a lista de conversas"
                className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
                href="/conversas"
                id="btn-back-to-conversations"
              >
                <ArrowLeft aria-hidden="true" size={18} />
              </Link>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-text">
                  {isGroup ? `👥 ${displayName}` : displayName}
                </p>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {displayPhone && (
                  <p className="truncate text-caption text-text-muted">{displayPhone}</p>
                )}
                {isGroup ? (
                  // Grupo nunca mostra prazo: só uma marca neutra.
                  <span className="inline-flex shrink-0 items-center rounded-pill border border-border bg-neutral-soft px-2 py-0.5 text-caption font-medium text-text-muted" data-testid="group-mark">
                    Grupo
                  </span>
                ) : (
                  <>
                    <SlaBadge
                      className="max-w-full truncate"
                      closed={isConversationClosed(liveConversation) || !conversationHasSla(liveConversation)}
                      direction={liveConversation.sla_direction}
                      lastActivityAt={liveConversation.sla_at}
                      variant="full"
                    />
                    {liveConversation.is_self ? null : (
                      <SlaControl
                        conversationId={conversation.conversation_id}
                        mode={(liveConversation.sla_mode ?? "active") as SlaMode}
                        onChanged={handleSlaChanged}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Responsáveis: dentro do cabeçalho, compacto (antes era uma linha própria que roubava altura das mensagens) */}
          {members.length > 0 ? (
            <AssigneesBar
              assignees={assignees}
              conversationId={conversation.conversation_id}
              key={conversation.conversation_id}
              members={members}
              visibility={liveConversation.visibility}
            />
          ) : null}

          {/* Ações do Cabeçalho */}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:flex-none sm:gap-2">
            {/* Troca de Etapa do Kanban diretamente na conversa */}
            {activeOpp ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                <span className="hidden lg:inline text-xs text-text-muted font-medium">
                  Etapa:
                </span>
                <select
                  aria-label="Alterar etapa da oportunidade ativa"
                  className="min-h-11 min-w-0 flex-1 rounded-control border border-border bg-background px-2.5 text-caption font-semibold text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 sm:min-h-9 sm:max-w-[10rem] sm:flex-none"
                  onChange={(e) => {
                    handleStageSelect(e.target.value);
                  }}
                  value={displayedStageId ?? activeOpp.current_stage_id}
                >
                  {stages.map((stg) => (
                    <option key={stg.id} value={stg.id}>
                      {stg.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <Button
                onClick={() => setIsCreateOppOpen(true)}
                variant="secondary"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline 2xl:hidden">Oportunidade</span>
                <span className="hidden 2xl:inline">Criar oportunidade</span>
              </Button>
            )}

            {/* Marcar como Não Lida (Desktop direto, no Mobile via menu de 44px) */}
            <button
              aria-label={liveConversation.is_unread ? "Marcar como lida" : "Marcar como não lida"}
              className="hidden size-9 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text sm:flex"
              onClick={handleToggleUnread}
              title={liveConversation.is_unread ? "Marcar como lida" : "Marcar como não lida"}
              type="button"
            >
              <Mail size={18} />
            </button>

            {/* Buscar dentro desta conversa */}
            <button
              aria-label="Buscar nesta conversa"
              aria-pressed={searchOpen}
              className={[
                "flex size-11 shrink-0 items-center justify-center rounded-control transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:size-9",
                searchOpen ? "bg-neutral-soft text-text" : "text-text-muted",
              ].join(" ")}
              data-testid="conversation-search-toggle"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              title="Buscar nesta conversa"
              type="button"
            >
              <Search size={18} />
            </button>

            {/* Só o dono: mensagens escondidas (restaurar) */}
            {viewer?.role === "owner" ? (
              <button
                aria-label="Mensagens escondidas"
                className="hidden size-9 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text sm:flex"
                data-testid="hidden-messages-toggle"
                onClick={() => setHiddenOpen(true)}
                title="Mensagens escondidas (restaurar)"
                type="button"
              >
                <EyeOff size={18} />
              </button>
            ) : null}

            {/* Fixar no topo da lista (só para você) */}
            <button
              aria-label={liveConversation.is_pinned ? "Desafixar conversa" : "Fixar conversa no topo"}
              aria-pressed={Boolean(liveConversation.is_pinned)}
              className="hidden size-9 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text sm:flex"
              data-testid="conversation-pin-toggle"
              onClick={handleTogglePin}
              title={liveConversation.is_pinned ? "Desafixar conversa" : "Fixar conversa no topo da sua lista"}
              type="button"
            >
              {liveConversation.is_pinned ? <PinOff size={18} /> : <Pin size={18} />}
            </button>

            <button
              aria-label={liveConversation.archived_at ? "Desarquivar conversa" : "Arquivar conversa"}
              className="hidden size-9 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text sm:flex"
              onClick={handleArchive}
              title={liveConversation.archived_at ? "Desarquivar conversa" : "Arquivar conversa"}
              type="button"
            >
              {liveConversation.archived_at ? <ArchiveRestore size={18} /> : <Archive size={18} />}
            </button>
            {isGroup && canManagePrivacy ? (
              <button
                className={[
                  "inline-flex min-h-9 items-center rounded-control border px-2.5 text-caption font-medium hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  liveConversation.visibility === "commercial" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-border text-text-muted",
                ].join(" ")}
                data-testid="group-visibility-toggle"
                title={liveConversation.visibility === "commercial" ? "Hoje a equipe vê este grupo (a partir da liberação)" : "Hoje só você vê este grupo"}
                onClick={() => startTransition(async () => {
                  const teamVisible = liveConversation.visibility !== "commercial";
                  const result = await setGroupTeamVisibilityAction(conversation.conversation_id, teamVisible);
                  if (result.success) setLiveConversation((previous) => ({ ...previous, visibility: teamVisible ? "commercial" : "owner_only" }));
                })}
                type="button"
              >
                {liveConversation.visibility === "commercial" ? "Restringir ao dono" : "Liberar para a equipe"}
              </button>
            ) : null}

            {/* Contexto sempre sob demanda, em drawer no desktop e no mobile. */}
            <button
              aria-label="Abrir dados do cliente"
              className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:size-9"
              onClick={() => setIsContextOpen(true)}
              title="Informações do cliente"
              type="button"
            >
              <Info size={20} />
            </button>
          </div>
        </div>

        {searchOpen ? (
          <ConversationSearch
            error={searchError}
            index={searchIndex}
            loading={searchLoading}
            onClose={closeSearch}
            onNewer={() => void goToMatch(searchMatches, Math.max(0, searchIndex - 1))}
            onOlder={() => void goToMatch(searchMatches, Math.min(searchMatches.length - 1, searchIndex + 1))}
            onQueryChange={handleSearchQueryChange}
            query={searchQuery}
            seeking={searchSeeking}
            total={searchTotal}
          />
        ) : null}

        {/* Histórico de Mensagens */}
        <div
          aria-label="Histórico de mensagens"
          className="flex-1 overflow-y-auto px-3 py-3 sm:px-4"
          onScroll={handleLogScroll}
          ref={listRef}
          role="log"
        >
          {hasOlder && (
            <div className="mb-4 flex justify-center">
              <button
                className="min-h-11 rounded-control border border-border px-4 text-caption text-text-muted transition-colors hover:bg-neutral-soft disabled:opacity-50"
                disabled={isLoadingOlder}
                id="btn-load-older-messages"
                onClick={handleLoadOlder}
                type="button"
              >
                {isLoadingOlder ? "Carregando…" : "Carregar anteriores"}
              </button>
            </div>
          )}

          {messages.length === 0 && threadNotes.length === 0 && !hasOlder && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm text-text-muted">
                Esta conversa ainda não possui mensagens.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2" ref={contentRef}>
            {timeline.map((entry, idx) => {
              const showDateSeparator = idx === 0 || !isSameDay(timeline[idx - 1].at, entry.at);
              const highlighted = highlightedId === (entry.type === "note" ? entry.note.id : entry.message.id);

              if (entry.type === "note") {
                return (
                  <div
                    className={highlighted ? "rounded-xl ring-2 ring-primary/60" : undefined}
                    data-note-id={entry.note.id}
                    data-occurred-at={entry.at}
                    key={entry.key}
                  >
                    {showDateSeparator && <DateSeparator dateString={entry.at} />}
                    <NoteBubble
                      highlight={highlightTerm}
                      note={entry.note}
                      onDelete={handleNoteDelete}
                      onEdit={handleNoteEdit}
                      viewer={viewer}
                    />
                  </div>
                );
              }

              const msg = entry.message;
              const previous = entry.previousMessage;
              return (
                <div
                  className={highlighted ? "rounded-xl ring-2 ring-primary/60" : undefined}
                  data-message-id={msg.id}
                  data-occurred-at={msg.occurred_at}
                  key={entry.key}
                >
                  {showDateSeparator && (
                    <DateSeparator dateString={msg.occurred_at} />
                  )}
                  {msg.is_history && !previous?.is_history && (
                    <HistoryDivider kind="start" />
                  )}
                  {!msg.is_history && previous?.is_history && (
                    <HistoryDivider kind="end" />
                  )}
                  <MessageBubble
                    highlight={highlightTerm}
                    isGroup={isGroup}
                    isOutgoing={msg.direction === "outgoing"}
                    message={msg}
                    onCopy={handleCopy}
                    onDeleteForEveryone={(target) => {
                      setConfirmError(null);
                      setConfirmAction({ kind: "delete", message: target });
                    }}
                    onDiscard={handleDiscardFailed}
                    onEdit={handleStartEdit}
                    onForward={setForwardTarget}
                    onHide={(target) => {
                      setConfirmError(null);
                      setConfirmAction({ kind: "hide", message: target });
                    }}
                    onJumpToQuoted={(id) => void handleJumpToQuoted(id)}
                    onViewHistory={(target) => setHistoryTarget(target.id)}
                    onReact={(target, emoji) => void handleReact(target, emoji)}
                    onReply={handleReply}
                    onRetry={handleRetryMessage}
                    viewer={viewer}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {actionNotice ? (
          <div
            className="flex shrink-0 items-start justify-between gap-2 border-t border-danger/30 bg-danger-soft px-3 py-1.5 text-caption font-medium text-danger sm:px-4"
            data-testid="action-notice"
            role="alert"
          >
            <span className="break-words">{actionNotice}</span>
            <button
              aria-label="Fechar aviso"
              className="shrink-0 rounded-control px-1 hover:bg-surface/70"
              onClick={() => setActionNotice(null)}
              type="button"
            >
              ✕
            </button>
          </div>
        ) : null}

        {/* Compositor Fixo */}
        <MessageForm
          conversationId={conversation.conversation_id}
          contactName={liveConversation.participant_name}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onCancelReply={() => setReplyTo(null)}
          onNoteSaved={() => void refreshThreadNotes()}
          onReplyConsumed={() => setReplyTo(null)}
          onSaveEdit={handleSaveEdit}
          replyTo={replyTo}
          onInternalNoteSaved={handleInternalNoteSaved}
          onMessagePersisted={handleMessagePersisted}
          onMessageFailed={handleMessageFailed}
          onMessageSending={handleMessageSending}
          onMessageSettled={handleMessageSettled}
          opportunityId={effectiveOpportunityId}
          outgoing={outgoing}
          filesEnabled={!isGroup}
        />
      </div>

      <MessageHistoryDialog messageId={historyTarget} onClose={() => setHistoryTarget(null)} />
      <HiddenMessagesDialog
        conversationId={conversation.conversation_id}
        onClose={() => setHiddenOpen(false)}
        onRestored={() => {
          void refreshConversationMessagesAction(conversation.conversation_id).then((page) => setMessages((previous) => mergeMessages(previous, page.messages)));
        }}
        open={hiddenOpen}
      />
      <ForwardDialog
        currentConversationId={conversation.conversation_id}
        message={forwardTarget}
        onClose={() => setForwardTarget(null)}
      />

      <ConfirmDialog
        confirmLabel={confirmError ? "Tentar de novo" : confirmAction?.kind === "hide" ? "Apagar para mim" : "Apagar para todos"}
        description={
          confirmAction?.kind === "hide"
            ? "Isso esconde a mensagem no ImobFlux. Ela continua no WhatsApp."
            : "A mensagem será apagada no WhatsApp do cliente e no ImobFlux (ela vira \"Esta mensagem foi apagada\"). O WhatsApp só permite isso até 48 horas depois do envio."
        }
        destructive
        error={confirmError}
        onCancel={() => {
          if (!confirmBusy) setConfirmAction(null);
        }}
        onConfirm={() => void runConfirmedAction()}
        open={confirmAction !== null}
        pending={confirmBusy}
        title={confirmAction?.kind === "hide" ? "Apagar para mim?" : "Apagar para todos?"}
      />

      {/* Contexto da conversa sob demanda em todos os viewports. */}
      <Drawer
        onClose={() => setIsContextOpen(false)}
        open={isContextOpen && Boolean(selectedContext)}
        title="Dados do cliente"
      >
        {selectedContext ? (
          <ClientContextPanel
            context={selectedContext}
            conversationId={conversation.conversation_id}
            key={effectiveOpportunityId}
            liveNotes={threadNotes}
            onNoteDelete={handleNoteDelete}
            onNoteEdit={handleNoteEdit}
            viewer={viewer}
            onOpportunityChange={setSelectedOpportunityId}
            onContactUpdated={handleContactUpdated}
            opportunities={opportunityContexts}
            selectedOpportunityId={effectiveOpportunityId}
            stages={stages}
          />
        ) : null}
      </Drawer>

      {/* Modal de Criar Oportunidade */}
      <ModalDialog
        labelledBy="modal-create-opp-title"
        onOpenChange={setIsCreateOppOpen}
        open={isCreateOppOpen}
      >
          <form className="space-y-stack" onSubmit={handleCreateOpportunitySubmit}>
            <div>
              <h3 className="text-section-title font-semibold" id="modal-create-opp-title">
                Criar Oportunidade
              </h3>
              <p className="mt-inline text-body text-text-muted">
                Vincule esta conversa a uma nova oportunidade no Kanban.
              </p>
            </div>

            <label className="block space-y-inline" htmlFor="opp-title-input">
              <span className="text-body font-medium">Título da oportunidade</span>
              <Input
                id="opp-title-input"
                onChange={(e) => setOppTitle(e.target.value)}
                placeholder="Ex: Apartamento 3 Quartos Ponta Verde"
                required
                value={oppTitle}
              />
            </label>

            {oppError ? (
              <p className="rounded-control bg-danger-soft px-control-x py-control-y text-body text-danger" role="alert">
                {oppError}
              </p>
            ) : null}

            <div className="flex justify-end gap-inline pt-2">
              <Button onClick={() => setIsCreateOppOpen(false)} type="button" variant="ghost">
                Cancelar
              </Button>
              <Button disabled={isCreatingOpp} type="submit" variant="primary">
                {isCreatingOpp ? "Criando…" : "Criar oportunidade"}
              </Button>
            </div>
          </form>
      </ModalDialog>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

type TimelineEntry =
  | { type: "message"; key: string; at: string; message: ConversationMessage; previousMessage: ConversationMessage | undefined }
  | { type: "note"; key: string; at: string; note: ThreadNote };

/** Mensagens e notas internas numa só linha do tempo, por hora. Cada mensagem sabe qual é a mensagem anterior (divisor do histórico). */
function buildTimeline(messages: ConversationMessage[], notes: ThreadNote[]): TimelineEntry[] {
  const raw = [
    ...messages.map((message) => ({ sortKey: Date.parse(message.occurred_at), key: message.id, message, note: null as ThreadNote | null })),
    ...notes.map((note) => ({ sortKey: Date.parse(note.created_at), key: `note-${note.id}`, message: null as ConversationMessage | null, note })),
  ].sort((left, right) => left.sortKey - right.sortKey || left.key.localeCompare(right.key));

  let previousMessage: ConversationMessage | undefined;
  return raw.map((item): TimelineEntry => {
    if (item.note) return { type: "note", key: item.key, at: item.note.created_at, note: item.note };
    const message = item.message as ConversationMessage;
    const entry: TimelineEntry = { type: "message", key: item.key, at: message.occurred_at, message, previousMessage };
    previousMessage = message;
    return entry;
  });
}

function appendNotesToContext(
  context: ConversationContextData,
  notes: ConversationContextData["notes"],
): ConversationContextData {
  const noteIds = new Set(notes.map((note) => note.id));
  const noteEvents = notes.map((note) => ({
    event_type: "internal_note" as const,
    occurred_at: note.created_at,
    title: "Nota interna",
    description: note.content,
    actor: note.author_name,
  }));

  return {
    ...context,
    notes: [
      ...notes,
      ...context.notes.filter((note) => !noteIds.has(note.id)),
    ].sort((left, right) => right.created_at.localeCompare(left.created_at)),
    timeline: [...noteEvents, ...context.timeline]
      .filter((event, index, events) => events.findIndex((candidate) =>
        candidate.event_type === event.event_type
        && candidate.occurred_at === event.occurred_at
        && candidate.description === event.description,
      ) === index)
      .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at)),
  };
}

function DateSeparator({ dateString }: { dateString: string }) {
  const label = formatDateSeparator(dateString);
  return (
    <div
      aria-label={`Mensagens de ${label}`}
      className="my-3 flex items-center gap-3"
      role="separator"
    >
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-text-muted">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function HistoryDivider({ kind }: { kind: "start" | "end" }) {
  return (
    <div
      className="my-2 flex items-center gap-2 text-caption text-text-muted"
      data-testid={kind === "start" ? "history-divider-start" : "history-divider-end"}
      role="separator"
    >
      <div className="h-px flex-1 border-t border-dashed border-border-strong" />
      <span className="rounded-pill border border-dashed border-border-strong px-2.5 py-0.5">
        {kind === "start"
          ? "Histórico importado do WhatsApp (não conta no tempo de resposta)"
          : "Mensagens ao vivo a partir daqui"}
      </span>
      <div className="h-px flex-1 border-t border-dashed border-border-strong" />
    </div>
  );
}

function isSameDay(dateA: string, dateB: string): boolean {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateSeparator(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor(
    (now.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) /
      86_400_000,
  );
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
