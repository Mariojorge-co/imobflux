"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, MessageCircle, Plus } from "lucide-react";
import { Avatar, Button, EmptyState, Input, ModalDialog, SearchInput } from "@/components/ui";
import {
  refreshConversationsInboxAction,
  searchConversationsAction,
  searchNewConversationCandidatesAction,
  startIndividualConversationAction,
} from "@/lib/conversations/actions";
import type {
  ConversationInboxCounts,
  ConversationInboxView,
  ConversationListItem,
  ConversationsCursor,
  NewConversationCandidate,
} from "@/lib/conversations/data";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/date";
import {
  CONVERSATION_CLIENT_UPDATE_EVENT,
  type ConversationClientUpdate,
} from "@/lib/conversations/client-events";

type ConversationsListProps = {
  initialItems: ConversationListItem[];
  initialCounts: ConversationInboxCounts;
  selectedId?: string;
};

export function ConversationsList({
  initialItems,
  initialCounts,
  selectedId,
}: ConversationsListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [items, setItems] = useState<ConversationListItem[]>(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [view, setView] = useState<ConversationInboxView>("all");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<ConversationsCursor | undefined>(
    () => buildCursor(initialItems),
  );
  const [hasMore, setHasMore] = useState(initialItems.length === 20);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [newConversationPhone, setNewConversationPhone] = useState("");
  const [newConversationError, setNewConversationError] = useState<string | null>(null);
  const [newConversationCandidates, setNewConversationCandidates] = useState<NewConversationCandidate[]>([]);
  const [resolvedPhone, setResolvedPhone] = useState<string | null>(null);
  const [isResolvingNewConversation, setIsResolvingNewConversation] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const newConversationDebounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const searchRef = useRef(search);
  const viewRef = useRef(view);

  useEffect(() => {
    searchRef.current = search;
    viewRef.current = view;
  }, [search, view]);

  // Reseta a lista sempre que a busca mudar
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        startTransition(async () => {
          const results = await searchConversationsAction(value, undefined, view);
          setItems(results);
          setCursor(buildCursor(results));
          setHasMore(results.length === 20);
        });
      }, 350);
    },
    [view],
  );

  // Disparo imediato ao pressionar Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        startTransition(async () => {
          const results = await searchConversationsAction(search, undefined, view);
          setItems(results);
          setCursor(buildCursor(results));
          setHasMore(results.length === 20);
        });
      }
      if (e.key === "Escape") {
        setSearch("");
        startTransition(async () => {
          const results = await searchConversationsAction("", undefined, view);
          setItems(results);
          setCursor(buildCursor(results));
          setHasMore(results.length === 20);
        });
      }
    },
    [search, view],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const more = await searchConversationsAction(search, cursor, view);
      setItems((prev) => [...prev, ...more]);
      setCursor(buildCursor(more));
      setHasMore(more.length === 20);
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, search, isLoadingMore, view]);

  const reconcile = useCallback(() => {
    startTransition(async () => {
      const result = await refreshConversationsInboxAction(searchRef.current, viewRef.current);
      setItems(result.items);
      setCounts(result.counts);
      setCursor(buildCursor(result.items));
      setHasMore(result.items.length === 20);
    });
  }, []);

  const handleViewChange = useCallback((nextView: ConversationInboxView) => {
    setView(nextView);
    startTransition(async () => {
      const result = await refreshConversationsInboxAction(search, nextView);
      setItems(result.items);
      setCounts(result.counts);
      setCursor(buildCursor(result.items));
      setHasMore(result.items.length === 20);
    });
  }, [search]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (newConversationDebounceRef.current) clearTimeout(newConversationDebounceRef.current);
    };
  }, []);

  const resolveNewConversation = useCallback((value: string) => {
    if (newConversationDebounceRef.current) clearTimeout(newConversationDebounceRef.current);
    setNewConversationPhone(value);
    setNewConversationError(null);
    setResolvedPhone(null);
    if (value.trim().length < 2) {
      setNewConversationCandidates([]);
      setIsResolvingNewConversation(false);
      return;
    }

    setIsResolvingNewConversation(true);
    newConversationDebounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result = await searchNewConversationCandidatesAction(value);
        setNewConversationCandidates(result.candidates);
        setResolvedPhone(result.normalizedPhone);
        setIsResolvingNewConversation(false);
      });
    }, 320);
  }, []);

  const openOrStartCandidate = useCallback(async (candidate: NewConversationCandidate) => {
    if (candidate.conversationId) {
      setIsNewConversationOpen(false);
      router.push(`/conversas/${candidate.conversationId}`);
      return;
    }
    if (!candidate.phone) {
      setNewConversationError("Este contato não possui telefone disponível.");
      return;
    }
    const result = await startIndividualConversationAction(candidate.phone);
    if (!result.success) {
      setNewConversationError(result.error);
      return;
    }
    setIsNewConversationOpen(false);
    router.push(`/conversas/${result.conversationId}`);
  }, [router]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let active = true;
    const scheduleReconcile = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(reconcile, 80);
    };
    const subscribe = () => {
      if (!active) return;
      channel = supabase
        .channel(`authorized-conversations-inbox-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, scheduleReconcile)
        .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, scheduleReconcile)
        .on("postgres_changes", { event: "*", schema: "public", table: "conversation_read_states" }, scheduleReconcile)
        .subscribe((status) => {
          document.documentElement.dataset.realtimeInbox = status.toLowerCase();
          if (status === "SUBSCRIBED") {
            document.documentElement.dataset.realtimeInbox = "ready";
            reconcile();
          } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && active) {
            const failedChannel = channel;
            retryTimer = setTimeout(() => {
              if (failedChannel) void supabase.removeChannel(failedChannel);
              subscribe();
            }, 1_000);
          }
        });
    };
    subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      active = false;
      delete document.documentElement.dataset.realtimeInbox;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [reconcile]);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const { detail } = event as CustomEvent<ConversationClientUpdate>;
      setItems((previous) => {
        const updated = previous.map((item) => {
          if (item.conversation_id !== detail.conversationId) return item;

          return {
            ...item,
            ...(detail.participantName === undefined
              ? {}
              : { participant_name: detail.participantName }),
            ...(detail.isUnread === undefined
              ? {}
              : { is_unread: detail.isUnread }),
            ...(detail.message
              ? {
                  last_activity_at: detail.message.occurred_at,
                  last_msg_direction: detail.message.direction,
                  last_msg_occurred_at: detail.message.occurred_at,
                  last_msg_text: detail.message.text_content,
                }
              : {}),
          };
        });

        if (!detail.message) return updated;
        return updated.sort(
          (left, right) =>
            right.last_activity_at.localeCompare(left.last_activity_at)
            || right.conversation_id.localeCompare(left.conversation_id),
        );
      });
    };

    window.addEventListener(CONVERSATION_CLIENT_UPDATE_EVENT, handleUpdate);
    return () => window.removeEventListener(CONVERSATION_CLIENT_UPDATE_EVENT, handleUpdate);
  }, []);

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface">
      {/* Cabeçalho da coluna esquerda (desktop) */}
      <div className="border-b border-border p-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h1 className="text-section-title font-semibold text-text">Conversas</h1>
          <Button className="px-2.5" onClick={() => setIsNewConversationOpen(true)} variant="secondary">
            <Plus aria-hidden="true" size={16} /> Nova conversa
          </Button>
        </div>
        <SearchInput
          aria-label="Buscar conversas por nome ou telefone"
          label="Buscar por nome ou telefone"
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nome ou telefone…"
          value={search}
        />
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Filtros de conversas">
          {([
            ["all", `Tudo (${counts.all})`],
            ["unread", `Não lidas (${counts.unread})`],
            ["groups", `Grupos (${counts.groups})`],
          ] as Array<[ConversationInboxView, string]>).map(([key, label]) => (
            <button
              aria-pressed={view === key}
              className={view === key ? "min-h-11 rounded-pill bg-primary px-3 text-caption font-medium text-primary-foreground" : "min-h-11 rounded-pill border border-transparent bg-neutral-soft px-3 text-caption font-medium text-text-muted hover:border-border-strong hover:text-text"}
              key={key}
              onClick={() => handleViewChange(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          aria-pressed={view === "archived"}
          className={view === "archived" ? "mt-1.5 flex min-h-11 w-full items-center gap-2 rounded-control bg-neutral-soft px-3 text-caption font-medium text-text" : "mt-1.5 flex min-h-11 w-full items-center gap-2 rounded-control px-3 text-caption text-text-muted hover:bg-neutral-soft hover:text-text"}
          onClick={() => handleViewChange("archived")}
          type="button"
        >
          <Archive size={14} /> Arquivadas ({counts.archived})
          {counts.archived_unread > 0 ? <span className="ml-auto rounded-full bg-primary px-1.5 text-primary-foreground">{counts.archived_unread}</span> : null}
        </button>
      </div>
      <ModalDialog
        labelledBy="new-conversation-title"
        onOpenChange={setIsNewConversationOpen}
        open={isNewConversationOpen}
      >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const existing = newConversationCandidates.find((candidate) => candidate.conversationId);
                if (existing) {
                  await openOrStartCandidate(existing);
                  return;
                }
                if (!resolvedPhone) {
                  setNewConversationError("Informe um telefone brasileiro completo e válido.");
                  return;
                }
                const result = await startIndividualConversationAction(resolvedPhone);
                if (!result.success) {
                  setNewConversationError(result.error);
                  return;
                }
                setIsNewConversationOpen(false);
                router.push(`/conversas/${result.conversationId}`);
              });
            }}
          >
            <div><h2 className="font-semibold" id="new-conversation-title">Nova conversa</h2><p className="text-caption text-text-muted">Pesquisar nome ou número</p></div>
            <Input aria-label="Pesquisar nome ou número" aria-busy={isResolvingNewConversation} onChange={(event) => resolveNewConversation(event.target.value)} placeholder="Nome ou número" value={newConversationPhone} />
            {isResolvingNewConversation ? <p className="text-xs text-text-muted">Buscando…</p> : null}
            {!isResolvingNewConversation && newConversationCandidates.length > 0 ? (
              <div aria-label="Resultados para nova conversa" className="divide-y divide-border rounded-control border border-border">
                {newConversationCandidates.map((candidate) => (
                  <button
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-soft"
                    key={candidate.contactId ?? candidate.conversationId}
                    onClick={() => startTransition(() => openOrStartCandidate(candidate))}
                    type="button"
                  >
                    <span className="min-w-0"><strong className="block truncate">{candidate.displayName}</strong><span className="text-xs text-text-muted">{candidate.phone ?? "Sem telefone"}</span></span>
                    <span className="shrink-0 text-xs font-medium text-primary">{candidate.conversationId ? "Abrir" : "Iniciar"}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {!isResolvingNewConversation && resolvedPhone && newConversationCandidates.length === 0 ? (
              <p className="text-xs text-text-muted">Número novo. Use “Iniciar conversa” para continuar.</p>
            ) : null}
            {newConversationError ? <p className="text-xs text-text-muted">{newConversationError}</p> : null}
            <div className="flex justify-end gap-2"><Button onClick={() => { setIsNewConversationOpen(false); setNewConversationError(null); setNewConversationCandidates([]); setResolvedPhone(null); }} type="button" variant="ghost">Cancelar</Button><Button disabled={isResolvingNewConversation || (!resolvedPhone && newConversationCandidates.length === 0)} type="submit">{resolvedPhone && newConversationCandidates.length === 0 ? "Iniciar conversa" : "Continuar"}</Button></div>
          </form>
      </ModalDialog>

      {/* Lista de conversas */}
      <div
        aria-busy={isPending}
        aria-label="Lista de conversas"
        className="flex-1 overflow-y-auto"
        role="list"
      >
        {isPending && (
          <div
            aria-label="Buscando conversas"
            className="h-0.5 animate-pulse bg-primary/30"
            role="status"
          />
        )}

        {!isPending && items.length === 0 && (
          <EmptyState
            className="m-3 border-0 py-section"
            description={search ? "Tente outro nome ou telefone." : "As conversas autorizadas aparecerão aqui."}
            icon={MessageCircle}
            title={search ? "Nenhuma conversa encontrada" : "Nenhuma conversa disponível"}
          />
        )}

        {items.map((conv) => (
          <ConversationCard
            isSelected={conv.conversation_id === selectedId}
            item={conv}
            key={conv.conversation_id}
            onClick={() =>
              router.push(`/conversas/${conv.conversation_id}`)
            }
          />
        ))}

        {hasMore && (
          <div className="p-3">
            <button
              className="w-full rounded-control border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:bg-neutral-soft disabled:opacity-50"
              disabled={isLoadingMore}
              id="btn-load-more-conversations"
              onClick={loadMore}
              type="button"
            >
              {isLoadingMore ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-componente: card de conversa ─────────────────────────────────────────

type ConversationCardProps = {
  item: ConversationListItem;
  isSelected: boolean;
  onClick: () => void;
};

import { calculateSLA } from "@/lib/conversations/sla";

function ConversationCard({ item, isSelected, onClick }: ConversationCardProps) {
  const displayName = item.participant_name ?? "Participante desconhecido";
  const snippet = item.last_msg_text
    ? truncate(item.last_msg_text, 60)
    : "Sem mensagens";
  const timeLabel = formatRelativeTime(item.last_activity_at);
  const isGroup = item.conversation_type === "group";
  const sla = calculateSLA(item.last_msg_direction, item.last_activity_at);

  const getSLABadgeClass = () => {
    if (!sla) return "";
    if (sla.type === "team_waiting") {
      switch (sla.level) {
        case "normal": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
        case "attention": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
        case "priority": return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
        case "critical":
        case "critical_grave": return "bg-rose-500/15 text-rose-700 dark:text-rose-400 font-bold";
        default: return "bg-neutral-soft text-text-muted";
      }
    } else {
      switch (sla.level) {
        case "recent":
        case "waiting_client": return "bg-slate-500/15 text-slate-700 dark:text-slate-400";
        case "attention":
        case "followup_candidate": return "bg-purple-500/15 text-purple-700 dark:text-purple-400";
        default: return "bg-neutral-soft text-text-muted";
      }
    }
  };

  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      aria-label={`Abrir conversa com ${displayName}`}
      className={[
        "relative flex w-full cursor-pointer items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors",
        isSelected
          ? "bg-neutral-soft"
          : "hover:bg-neutral-soft/60",
        item.is_unread ? "border-l-4 border-l-primary" : "",
      ].join(" ")}
      id={`conv-card-${item.conversation_id}`}
      onClick={onClick}
      type="button"
    >
      <Avatar className="mt-0.5" name={displayName} size="sm" src={item.avatar_url ?? undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
          {item.is_unread && (
            <span className="h-2 w-2 rounded-full bg-primary shrink-0" title="Não lida" />
          )}
          <span className="truncate text-sm font-medium text-text">
            {isGroup ? `👥 ${displayName}` : displayName}
          </span>
        </div>
          <span className="shrink-0 text-caption text-text-muted">{timeLabel}</span>
        </div>
        <p className="mt-0.5 truncate text-caption text-text-muted">{snippet}</p>

      {sla && (
        <div className="mt-1 flex min-w-0 items-center gap-1">
          <span
            className={[
              "max-w-full truncate rounded-pill px-2 py-0.5 text-caption font-medium tracking-tight",
              getSLABadgeClass(),
            ].join(" ")}
          >
            {sla.badgeText}
          </span>
        </div>
        )}
      </div>
    </button>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildCursor(
  items: ConversationListItem[],
): ConversationsCursor | undefined {
  const last = items[items.length - 1];
  if (!last?.next_cursor_ts || !last?.next_cursor_id) return undefined;
  return { ts: last.next_cursor_ts, id: last.next_cursor_id };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
