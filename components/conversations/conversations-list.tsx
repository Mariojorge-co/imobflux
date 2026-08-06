"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { SearchInput } from "@/components/ui";
import { searchConversationsAction } from "@/lib/conversations/actions";
import type {
  ConversationListItem,
  ConversationsCursor,
} from "@/lib/conversations/data";
import { formatRelativeTime } from "@/lib/date";

type ConversationsListProps = {
  initialItems: ConversationListItem[];
  selectedId?: string;
};

export function ConversationsList({
  initialItems,
  selectedId,
}: ConversationsListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [items, setItems] = useState<ConversationListItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<ConversationsCursor | undefined>(
    () => buildCursor(initialItems),
  );
  const [hasMore, setHasMore] = useState(initialItems.length === 20);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Reseta a lista sempre que a busca mudar
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        startTransition(async () => {
          const results = await searchConversationsAction(value, undefined);
          setItems(results);
          setCursor(buildCursor(results));
          setHasMore(results.length === 20);
        });
      }, 350);
    },
    [],
  );

  // Disparo imediato ao pressionar Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        startTransition(async () => {
          const results = await searchConversationsAction(search, undefined);
          setItems(results);
          setCursor(buildCursor(results));
          setHasMore(results.length === 20);
        });
      }
      if (e.key === "Escape") {
        setSearch("");
        startTransition(async () => {
          const results = await searchConversationsAction("", undefined);
          setItems(results);
          setCursor(buildCursor(results));
          setHasMore(results.length === 20);
        });
      }
    },
    [search],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const more = await searchConversationsAction(search, cursor);
      setItems((prev) => [...prev, ...more]);
      setCursor(buildCursor(more));
      setHasMore(more.length === 20);
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, search, isLoadingMore]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface">
      {/* Cabeçalho da coluna esquerda (desktop) */}
      <div className="border-b border-border p-4">
        <h1 className="mb-3 text-section-title font-semibold text-text">
          Conversas
        </h1>
        <SearchInput
          aria-label="Buscar conversas por nome ou telefone"
          label="Buscar por nome ou telefone"
          onChange={(e) => handleSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nome ou telefone…"
          value={search}
        />
      </div>

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

function ConversationCard({ item, isSelected, onClick }: ConversationCardProps) {
  const displayName = item.participant_name ?? "Participante desconhecido";
  const snippet = item.last_msg_text
    ? truncate(item.last_msg_text, 72)
    : "Sem mensagens";
  const timeLabel = formatRelativeTime(item.last_activity_at);
  const isGroup = item.conversation_type === "group";

  return (
    <button
      aria-current={isSelected ? "true" : undefined}
      aria-label={`Abrir conversa com ${displayName}`}
      className={[
        "flex w-full cursor-pointer flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors",
        isSelected
          ? "bg-neutral-soft"
          : "hover:bg-neutral-soft/60",
      ].join(" ")}
      id={`conv-card-${item.conversation_id}`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-text">
          {isGroup ? `👥 ${displayName}` : displayName}
        </span>
        <span className="shrink-0 text-xs text-text-muted">{timeLabel}</span>
      </div>
      <p className="truncate text-xs text-text-muted">{snippet}</p>
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
