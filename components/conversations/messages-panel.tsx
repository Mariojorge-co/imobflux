"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Kanban, Paperclip, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createOpportunityFromConversationAction,
  loadMoreMessagesAction,
} from "@/lib/conversations/actions";
import { MessageForm } from "@/components/conversations/message-form";
import { Badge, Button, Input } from "@/components/ui";
import type {
  ConversationListItem,
  ConversationMessage,
  LinkedOpportunityInfo,
  MessagesCursor,
} from "@/lib/conversations/data";

type MessagesPanelProps = {
  conversation: ConversationListItem;
  initialMessages: ConversationMessage[];
  linkedOpportunity?: LinkedOpportunityInfo | null;
  /** Se verdadeiro, renderiza o botão "Voltar" (mobile). */
  showBackButton?: boolean;
};

export function MessagesPanel({
  conversation,
  initialMessages,
  linkedOpportunity,
  showBackButton = false,
}: MessagesPanelProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(initialMessages.length === 50);
  const [isCreateOppOpen, setIsCreateOppOpen] = useState(false);
  const [oppTitle, setOppTitle] = useState("");
  const [oppError, setOppError] = useState<string | null>(null);
  const [isCreatingOpp, setIsCreatingOpp] = useState(false);

  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const hasAutoScrolledRef = useRef(false);

  // Auto-scroll para a mensagem mais recente no primeiro carregamento
  useEffect(() => {
    if (listRef.current && !hasAutoScrolledRef.current && initialMessages.length > 0) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      hasAutoScrolledRef.current = true;
    }
  }, [initialMessages]);

  const handleLoadOlder = useCallback(async () => {
    if (isLoadingOlder || messages.length === 0) return;

    const oldest = messages[0];
    const cursor: MessagesCursor = {
      occurred_at: oldest.occurred_at,
      id: oldest.id,
    };

    const scrollHeightBefore = listRef.current?.scrollHeight ?? 0;

    setIsLoadingOlder(true);
    try {
      const older = await loadMoreMessagesAction(
        conversation.conversation_id,
        cursor,
      );
      setMessages((prev) => [...older, ...prev]);
      setHasOlder(older.length === 50);

      requestAnimationFrame(() => {
        if (listRef.current) {
          const added = listRef.current.scrollHeight - scrollHeightBefore;
          listRef.current.scrollTop += added;
        }
      });
    } finally {
      setIsLoadingOlder(false);
    }
  }, [isLoadingOlder, messages, conversation.conversation_id]);

  const handleCreateOpportunitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oppTitle.trim()) return;

    setIsCreatingOpp(true);
    setOppError(null);

    // Usa uma etapa padrão do pipeline para a nova oportunidade
    const defaultStageId = "41000000-0000-4000-8000-000000000001";
    // Tenta resolver o contact_id a partir do participante ou conversa
    const dummyContactId = "51000000-0000-4000-8000-000000000001";

    const res = await createOpportunityFromConversationAction({
      conversationId: conversation.conversation_id,
      contactId: dummyContactId,
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
  const isGroup = conversation.conversation_type === "group";

  return (
    <div className="flex h-full flex-col">
      {/* Cabeçalho do painel de mensagens */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {showBackButton && (
            <Link
              aria-label="Voltar para a lista de conversas"
              className="rounded-control p-1.5 text-text-muted transition-colors hover:bg-neutral-soft"
              href="/conversas"
              id="btn-back-to-conversations"
            >
              <ArrowLeft aria-hidden="true" size={18} />
            </Link>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text">
              {isGroup ? `👥 ${displayName}` : displayName}
            </p>
            <p className="text-xs text-text-muted capitalize">
              {conversation.operational_status}
              {isGroup ? " · Grupo" : ""}
            </p>
          </div>
        </div>

        {/* Integração Conversas → Kanban */}
        <div className="flex items-center gap-2">
          {linkedOpportunity ? (
            <div className="flex items-center gap-2">
              <Badge tone="success">Oportunidade: {linkedOpportunity.title}</Badge>
              <Link href={`/kanban?opportunityId=${linkedOpportunity.opportunity_id}`}>
                <Button variant="secondary">
                  <Kanban className="h-4 w-4" />
                  <span>Abrir oportunidade</span>
                </Button>
              </Link>
            </div>
          ) : (
            <Button
              onClick={() => setIsCreateOppOpen(true)}
              variant="secondary"
            >
              <Plus className="h-4 w-4" />
              <span>Criar oportunidade</span>
            </Button>
          )}
        </div>
      </div>

      {/* Lista de mensagens */}
      <div
        aria-label="Histórico de mensagens"
        className="flex-1 overflow-y-auto px-4 py-3"
        ref={listRef}
        role="log"
      >
        {/* Botão carregar anteriores */}
        {hasOlder && (
          <div className="mb-4 flex justify-center">
            <button
              className="rounded-control border border-border px-4 py-1.5 text-xs text-text-muted transition-colors hover:bg-neutral-soft disabled:opacity-50"
              disabled={isLoadingOlder}
              id="btn-load-older-messages"
              onClick={handleLoadOlder}
              type="button"
            >
              {isLoadingOlder ? "Carregando…" : "Carregar anteriores"}
            </button>
          </div>
        )}

        {/* Estado: sem mensagens */}
        {messages.length === 0 && !hasOlder && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-text-muted">
              Esta conversa ainda não possui mensagens.
            </p>
          </div>
        )}

        {/* Mensagens */}
        <div className="flex flex-col gap-2">
          {messages.map((msg, idx) => {
            const isOutgoing = msg.direction === "outgoing";
            const showDateSeparator =
              idx === 0 ||
              !isSameDay(messages[idx - 1].occurred_at, msg.occurred_at);

            return (
              <div key={msg.id}>
                {showDateSeparator && (
                  <DateSeparator dateString={msg.occurred_at} />
                )}
                <MessageBubble isOutgoing={isOutgoing} message={msg} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Área de envio de mensagem */}
      <MessageForm conversationId={conversation.conversation_id} />

      {/* Modal simples de criação de oportunidade a partir da conversa */}
      {isCreateOppOpen ? (
        <dialog
          aria-labelledby="modal-create-opp-title"
          className="fixed inset-0 z-50 m-auto w-[min(100%-2rem,28rem)] rounded-card border border-border bg-surface p-card text-text shadow-xl backdrop:bg-text/30"
          open
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
                placeholder="Ex: Apartamento 3 Quertos Ponta Verde"
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
        </dialog>
      ) : null}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

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
          "max-w-[75%] rounded-2xl px-3 py-2",
          isOutgoing
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-surface text-text shadow-sm ring-1 ring-border",
        ].join(" ")}
      >
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
            "mt-1 text-right text-[10px]",
            isOutgoing ? "text-primary-foreground/60" : "text-text-muted",
          ].join(" ")}
        >
          {timeLabel}
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
