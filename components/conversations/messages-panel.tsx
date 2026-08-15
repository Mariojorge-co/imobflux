"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Info, Mail, Paperclip, Plus } from "lucide-react";
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
import { MessageForm } from "@/components/conversations/message-form";
import { Button, Drawer, Input, ModalDialog } from "@/components/ui";
import { calculateSLA } from "@/lib/conversations/sla";
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
import { emitConversationClientUpdate } from "@/lib/conversations/client-events";
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
}: MessagesPanelProps) {
  const [, startTransition] = useTransition();
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages);
  const [liveConversation, setLiveConversation] = useState(conversation);
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
  const pendingScrollAdjustmentRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const shouldAutoReadRef = useRef(Boolean(conversation.is_unread));
  const pendingScrollToBottomRef = useRef(false);

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

  const sla = calculateSLA(
    liveConversation.last_msg_direction,
    liveConversation.last_activity_at,
  );

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

  const handleMessagePersisted = useCallback((message: ConversationMessage) => {
    pendingScrollToBottomRef.current = true;
    setMessages((previous) => {
      const byId = new Map(previous.map((item) => [item.id, item]));
      byId.set(message.id, message);
      return [...byId.values()].sort(
        (left, right) =>
          left.occurred_at.localeCompare(right.occurred_at)
          || left.id.localeCompare(right.id),
      );
    });

    setLiveConversation((previous) => ({
      ...previous,
      last_activity_at: message.occurred_at,
      last_msg_direction: message.direction,
      last_msg_occurred_at: message.occurred_at,
      last_msg_text: message.text_content,
      is_unread: false,
    }));
    emitConversationClientUpdate({
      conversationId: conversation.conversation_id,
      isUnread: false,
      message,
    });
  }, [conversation.conversation_id]);

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
  }, [conversation.conversation_id, effectiveOpportunityId, noteContextKey]);

  const handleLoadOlder = useCallback(async () => {
    if (isLoadingOlder || messages.length === 0) return;

    const oldest = messages[0];
    const cursor: MessagesCursor = {
      occurred_at: oldest.occurred_at,
      id: oldest.id,
    };

    setIsLoadingOlder(true);
    try {
      const page = await loadMoreMessagesAction(
        conversation.conversation_id,
        cursor,
      );
      const existingIds = new Set(messages.map((message) => message.id));
      const uniqueOlder = page.messages.filter((message) => !existingIds.has(message.id));

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
      setHasOlder(page.hasMore && uniqueOlder.length > 0);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [isLoadingOlder, messages, conversation.conversation_id]);

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
    const reconcileMessages = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          const page = await refreshConversationMessagesAction(conversation.conversation_id);
          if (disposed) return;
          setMessages((previous) => {
            const byId = new Map(previous.map((message) => [message.id, message]));
            for (const message of page.messages) byId.set(message.id, message);
            return [...byId.values()].sort((left, right) =>
              left.occurred_at.localeCompare(right.occurred_at)
              || left.id.localeCompare(right.id));
          });
          const newest = page.messages.at(-1);
          if (newest) {
            setLiveConversation((previous) => ({
              ...previous,
              last_activity_at: newest.occurred_at,
              last_msg_direction: newest.direction,
              last_msg_occurred_at: newest.occurred_at,
              last_msg_text: newest.text_content,
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
        if (status === "SUBSCRIBED") reconcileMessages();
      });
    const pollingTimer = setInterval(() => {
      reconcileMessages();
      void reconcileVisibleNotes();
    }, 2_000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (noteTimer) clearTimeout(noteTimer);
      clearInterval(pollingTimer);
      void supabase.removeChannel(channel);
    };
  }, [conversation.conversation_id, reconcileVisibleNotes]);

  const handleCreateOpportunitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oppTitle.trim()) return;

    setIsCreatingOpp(true);
    setOppError(null);

    const defaultStageId = "41000000-0000-4000-8000-000000000001";
    const contactId = context?.contact?.id || "51000000-0000-4000-8000-000000000001";

    const res = await createOpportunityFromConversationAction({
      conversationId: conversation.conversation_id,
      contactId,
      stageId: defaultStageId,
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
      {/* Coluna Principal da Conversa */}
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {/* Cabeçalho do painel de mensagens */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 w-full items-center gap-2 sm:w-auto sm:flex-1 sm:gap-3">
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
                {sla && (
                  <span
                    className={[
                      "hidden rounded-pill px-2 py-0.5 text-caption font-medium sm:inline-block",
                      sla.type === "team_waiting"
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                        : "bg-slate-500/15 text-slate-700 dark:text-slate-400",
                    ].join(" ")}
                  >
                    {sla.badgeText}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {displayPhone && (
                  <p className="truncate text-caption text-text-muted">{displayPhone}</p>
                )}
                {sla && (
                  <span
                    className={[
                      "inline-block max-w-full truncate rounded-pill px-2 py-0.5 text-caption font-medium sm:hidden",
                      sla.type === "team_waiting"
                        ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                        : "bg-slate-500/15 text-slate-700 dark:text-slate-400",
                    ].join(" ")}
                  >
                    {sla.badgeText}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Ações do Cabeçalho */}
          <div className="flex w-full min-w-0 items-center justify-between gap-1.5 sm:w-auto sm:justify-end sm:gap-2">
            {/* Troca de Etapa do Kanban diretamente na conversa */}
            {activeOpp ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
                <span className="hidden lg:inline text-xs text-text-muted font-medium">
                  Etapa:
                </span>
                <select
                  aria-label="Alterar etapa da oportunidade ativa"
                  className="min-h-11 min-w-0 flex-1 rounded-control border border-border bg-background px-2.5 text-caption font-semibold text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 sm:min-h-9 sm:max-w-[13rem] sm:flex-none"
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
                <span className="hidden sm:inline">Criar oportunidade</span>
              </Button>
            )}

            {/* Marcar como Não Lida (Desktop direto, no Mobile via menu de 44px) */}
            <button
              aria-label={liveConversation.is_unread ? "Marcar como lida" : "Marcar como não lida"}
              className="hidden sm:flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text"
              onClick={handleToggleUnread}
              title={liveConversation.is_unread ? "Marcar como lida" : "Marcar como não lida"}
              type="button"
            >
              <Mail size={18} />
            </button>

            <button
              aria-label={liveConversation.archived_at ? "Desarquivar conversa" : "Arquivar conversa"}
              className="hidden sm:flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text"
              onClick={handleArchive}
              title={liveConversation.archived_at ? "Desarquivar conversa" : "Arquivar conversa"}
              type="button"
            >
              {liveConversation.archived_at ? <ArchiveRestore size={18} /> : <Archive size={18} />}
            </button>
            {isGroup && canManagePrivacy ? (
              <button
                className="hidden rounded-control px-2 py-1 text-xs text-text-muted hover:bg-neutral-soft sm:block"
                onClick={() => startTransition(async () => {
                  const teamVisible = liveConversation.visibility !== "commercial";
                  const result = await setGroupTeamVisibilityAction(conversation.conversation_id, teamVisible);
                  if (result.success) setLiveConversation((previous) => ({ ...previous, visibility: teamVisible ? "commercial" : "owner_only" }));
                })}
                type="button"
              >
                {liveConversation.visibility === "commercial" ? "Tornar OWNER-only" : "Visível para equipe"}
              </button>
            ) : null}

            {/* Contexto sempre sob demanda, em drawer no desktop e no mobile. */}
            <button
              aria-label="Abrir dados do cliente"
              className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => setIsContextOpen(true)}
              title="Informações do cliente"
              type="button"
            >
              <Info size={20} />
            </button>
          </div>
        </div>

        {/* Histórico de Mensagens */}
        <div
          aria-label="Histórico de mensagens"
          className="flex-1 overflow-y-auto px-3 py-3 sm:px-4"
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

          {messages.length === 0 && !hasOlder && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-sm text-text-muted">
                Esta conversa ainda não possui mensagens.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {messages.map((msg, idx) => {
              const isOutgoing = msg.direction === "outgoing";
              const showDateSeparator =
                idx === 0 ||
                !isSameDay(messages[idx - 1].occurred_at, msg.occurred_at);

              return (
                <div
                  data-message-id={msg.id}
                  data-occurred-at={msg.occurred_at}
                  key={msg.id}
                >
                  {showDateSeparator && (
                    <DateSeparator dateString={msg.occurred_at} />
                  )}
                  <MessageBubble isOutgoing={isOutgoing} message={msg} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Compositor Fixo */}
        <MessageForm
          conversationId={conversation.conversation_id}
          onInternalNoteSaved={handleInternalNoteSaved}
          onMessagePersisted={handleMessagePersisted}
          opportunityId={effectiveOpportunityId}
        />
      </div>

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

type MessageBubbleProps = {
  message: ConversationMessage;
  isOutgoing: boolean;
};

function MessageBubble({ message, isOutgoing }: MessageBubbleProps) {
  const timeLabel = new Date(message.occurred_at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={[
        "flex",
        isOutgoing ? "justify-end" : "justify-start",
      ].join(" ")}
    >
      <div
        className={[
          "max-w-[88%] rounded-2xl px-3 py-2 sm:max-w-[75%]",
          isOutgoing
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-surface text-text shadow-sm ring-1 ring-border",
        ].join(" ")}
      >
        {/* Identificação de autor interno no CRM (somente visível internamente) */}
        {isOutgoing && message.internal_author_name && (
          <p className="mb-0.5 text-caption font-semibold text-primary-foreground/80">
            Enviado por {message.internal_author_name}
          </p>
        )}

        {message.has_attachments && (
          <div
            aria-label="Esta mensagem contém um anexo indisponível"
            className={[
              "mb-1.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
              isOutgoing
                ? "bg-white/10 text-primary-foreground/70"
                : "bg-neutral-soft text-text-muted",
            ].join(" ")}
          >
            <Paperclip aria-hidden="true" size={12} strokeWidth={1.8} />
            <span>Anexo indisponível</span>
          </div>
        )}

        {message.text_content && (
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.text_content}
          </p>
        )}

        <p
          className={[
            "mt-1 text-right text-caption",
            isOutgoing ? "text-primary-foreground/60" : "text-text-muted",
          ].join(" ")}
        >
          {timeLabel}
        </p>
      </div>
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
