import { notFound } from "next/navigation";
import {
  getConversationsList,
  getConversationById,
  getConversationMessages,
  getOpportunityForConversation,
} from "@/lib/conversations/data";
import { ConversationsList } from "@/components/conversations/conversations-list";
import { MessagesPanel } from "@/components/conversations/messages-panel";

type ConversationDetailPageProps = {
  params: Promise<{ conversationId: string }>;
};

/**
 * Rota dinâmica /conversas/[conversationId] — Server Component.
 */
export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const { conversationId } = await params;

  // Carrega lista, conversa específica, mensagens e oportunidade vinculada em paralelo
  const [allConversations, conversation, messages, linkedOpportunity] = await Promise.all([
    getConversationsList({ limit: 20 }),
    getConversationById(conversationId),
    getConversationMessages(conversationId),
    getOpportunityForConversation(conversationId),
  ]);

  if (!conversation) {
    notFound();
  }

  const items = allConversations.some(
    (c) => c.conversation_id === conversationId,
  )
    ? allConversations
    : [conversation, ...allConversations];

  return (
    <div className="flex h-full w-full">
      {/* Coluna esquerda: lista de conversas — oculta no mobile */}
      <div className="hidden w-80 shrink-0 md:block">
        <ConversationsList
          initialItems={items}
          selectedId={conversationId}
        />
      </div>

      {/* Coluna direita / tela cheia no mobile: painel de mensagens */}
      <div className="flex-1">
        <MessagesPanel
          conversation={conversation}
          initialMessages={messages}
          linkedOpportunity={linkedOpportunity}
          showBackButton={true}
        />
      </div>
    </div>
  );
}
