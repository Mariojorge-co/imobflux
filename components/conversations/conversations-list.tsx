"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, MessageCircle, Plus } from "lucide-react";
import { Avatar, SearchInput } from "@/components/ui";
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
      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="text-section-title font-semibold text-text">Conversas</h1>
          <button className="flex items-center gap-1 rounded-control px-2 py-1 text-xs font-medium text-primary hover:bg-neutral-soft" onClick={() => setIsNewConversationOpen(true)} type="button">
            <Plus size={14} /> Nova conversa
          </button>
        </div>
        <SearchInput
          aria-label="Buscar conversas por nome ou telefone"
          label="Buscar por nome ou telefone"
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nome ou telefone…"
          value={search}
        />
        <div className="mt-3 flex flex-wrap gap-1" aria-label="Filtros de conversas">
          {([
            ["all", `Tudo (${counts.all})`],
            ["unread", `Não lidas (${counts.unread})`],
            ["groups", `Grupos (${counts.groups})`],
          ] as Array<[ConversationInboxView, string]>).map(([key, label]) => (
            <button
              className={view === key ? "rounded-full bg-primary px-2.5 py-1 text-xs text-primary-foreground" : "rounded-full bg-neutral-soft px-2.5 py-1 text-xs text-text-muted"}
              key={key}
              onClick={() => handleViewChange(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className={view === "archived" ? "mt-2 flex w-full items-center gap-2 rounded-control bg-neutral-soft px-2 py-1.5 text-xs font-medium text-text" : "mt-2 flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-xs text-text-muted hover:bg-neutral-soft"}
          onClick={() => handleViewChange("archived")}
          type="button"
        >
          <Archive size={14} /> Arquivadas ({counts.archived})
          {counts.archived_unread > 0 ? <span className="ml-auto rounded-full bg-primary px-1.5 text-primary-foreground">{counts.archived_unread}</span> : null}
        </button>
      </div>
      {isNewConversationOpen ? (
        <dialog className="fixed inset-0 z-50 m-auto w-[min(100%-2rem,26rem)] rounded-card border border-border bg-surface p-5 text-text shadow-xl backdrop:bg-text/30" open>
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
            <div><h2 className="font-semibold">Nova conversa</h2><p className="text-xs text-text-muted">Pesquisar nome ou número</p></div>
            <input aria-label="Pesquisar nome ou número" aria-busy={isResolvingNewConversation} className="w-full rounded-control border border-border bg-background px-3 py-2 text-sm" onChange={(event) => resolveNewConversation(event.target.value)} placeholder="Nome ou número" value={newConversationPhone} />
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
            <div className="flex justify-end gap-2"><button className="rounded-control px-3 py-2 text-sm" onClick={() => { setIsNewConversationOpen(false); setNewConversationError(null); setNewConversationCandidates([]); setResolvedPhone(null); }} type="button">Cancelar</button><button className="rounded-control bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={isResolvingNewConversation || (!resolvedPhone && newConversationCandidates.length === 0)} type="submit">{resolvedPhone && newConversationCandidates.length === 0 ? "Iniciar conversa" : "Continuar"}</button></div>
          </form>
        </dialog>
      ) : null}

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
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <MessageCircle
              aria-hidden="true"
              className="text-text-muted"
              size={40}
              strokeWidth={1.4}
            />
            <p className="text-sm text-text-muted">
              {search
                ? "Nenhuma conversa encontrada para esta busca."
                : "Nenhuma conversa disponível."}
            </p>
          </div>
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
        "flex w-full cursor-pointer flex-col gap-1.5 border-b border-border px-4 py-3 text-left transition-colors relative",
        isSelected
          ? "bg-neutral-soft"
          : "hover:bg-neutral-soft/60",
        item.is_unread ? "border-l-4 border-l-primary" : "",
      ].join(" ")}
      id={`conv-card-${item.conversation_id}`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Avatar name={displayName} size="sm" src={item.avatar_url ?? undefined} />
          {item.is_unread && (
            <span className="h-2 w-2 rounded-full bg-primary shrink-0" title="Não lida" />
          )}
          <span className="truncate text-sm font-medium text-text">
            {isGroup ? `👥 ${displayName}` : displayName}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-text-muted">{timeLabel}</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-text-muted flex-1">{snippet}</p>
      </div>

      {sla && (
        <div className="mt-1 flex items-center gap-1">
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-tight",
              getSLABadgeClass(),
            ].join(" ")}
          >
            {sla.badgeText}
          </span>
        </div>
      )}
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
