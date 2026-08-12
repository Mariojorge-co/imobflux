import { redirect } from "next/navigation";
import {
  getConversationsInbox,
  getConversationById,
  getConversationMessages,
  getOpportunityForConversation,
  getConversationContext,
  getConversationOpportunityContexts,
  getConversationPipelineStages,
} from "@/lib/conversations/data";
import { ConversationsList } from "@/components/conversations/conversations-list";
import { MessagesPanel } from "@/components/conversations/messages-panel";
import { requireActiveAccess } from "@/lib/auth/dal";

type ConversationDetailPageProps = {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ opportunityId?: string }>;
};

/**
 * Rota dinâmica /conversas/[conversationId] — Server Component.
 */
export default async function ConversationDetailPage({
  params,
  searchParams,
}: ConversationDetailPageProps) {
  const { conversationId } = await params;
  const { opportunityId } = await searchParams;
  const access = await requireActiveAccess();

  // Carrega lista, conversa específica, mensagens, oportunidade vinculada e contexto em paralelo
  const [inbox, conversation, messagePage, linkedOpportunity, context] =
    await Promise.all([
      getConversationsInbox({ limit: 20 }),
      getConversationById(conversationId),
      getConversationMessages(conversationId),
      getOpportunityForConversation(conversationId),
      getConversationContext(conversationId),
    ]);

  if (!conversation) {
    redirect("/conversas?reason=access_changed");
  }

  const [opportunityContexts, pipelineStages] = await Promise.all([
    getConversationOpportunityContexts(context, conversationId),
    getConversationPipelineStages(conversationId),
  ]);

  // Se a conversa for aberta estando marcada como não lida, marcar automaticamente como lida (auto-read)
  const items = inbox.items.some(
    (c) => c.conversation_id === conversationId,
  )
    ? inbox.items
    : [conversation, ...inbox.items];

  return (
    <div className="flex h-full w-full">
      {/* Coluna esquerda: lista de conversas — oculta no mobile */}
      <div className="hidden w-80 shrink-0 md:block">
        <ConversationsList
          initialItems={items}
          initialCounts={inbox.counts}
          selectedId={conversationId}
        />
      </div>

      {/* Coluna central / direita em mobile: painel de mensagens + painel lateral */}
      <div className="flex-1 overflow-hidden">
        <MessagesPanel
          context={context}
          conversation={conversation}
          initialHasOlder={messagePage.hasMore}
          initialMessages={messagePage.messages}
          key={conversationId}
          linkedOpportunity={linkedOpportunity}
          initialSelectedOpportunityId={opportunityId}
          opportunityContexts={opportunityContexts}
          stages={pipelineStages}
          showBackButton={true}
          canManagePrivacy={access.role === "owner"}
        />
      </div>
    </div>
  );
}
