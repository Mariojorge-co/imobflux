import { redirect } from "next/navigation";
import {
  getConversationById,
  getConversationMessages,
  getOpportunityForConversation,
  getConversationContext,
  getConversationOpportunityContexts,
  getPipelineStagesByWorkspace,
  getConversationAssignees,
  getMemberDirectory,
} from "@/lib/conversations/data";
import { MessagesPanel } from "@/components/conversations/messages-panel";
import { requireActiveAccess } from "@/lib/auth/dal";

// O envio de arquivo (server action chamada desta página) espera a Evolution baixar e entregar o arquivo: até 60 s.
export const maxDuration = 60;

type ConversationDetailPageProps = {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ opportunityId?: string }>;
};

/**
 * Rota dinâmica /conversas/[conversationId] — Server Component.
 *
 * A lista de conversas NÃO é buscada aqui (ela vive no layout e continua montada ao trocar de conversa).
 * Todas as consultas que não dependem umas das outras saem juntas, junto com a verificação de sessão (os dados
 * continuam protegidos pela RLS; se a sessão for inválida a página redireciona e descarta o resultado).
 */
export default async function ConversationDetailPage({
  params,
  searchParams,
}: ConversationDetailPageProps) {
  const { conversationId } = await params;
  const { opportunityId } = await searchParams;

  const dataPromise = Promise.all([
    getConversationById(conversationId),
    getConversationMessages(conversationId),
    getOpportunityForConversation(conversationId),
    getConversationContext(conversationId),
    getPipelineStagesByWorkspace(),
    getConversationAssignees(conversationId),
    getMemberDirectory(),
  ]);
  // Se a sessão falhar, o redirecionamento abaixo interrompe a página: evita aviso de rejeição não tratada.
  dataPromise.catch(() => undefined);

  const access = await requireActiveAccess();
  const [conversation, messagePage, linkedOpportunity, context, allStages, assignees, members] = await dataPromise;

  if (!conversation) {
    redirect("/conversas?reason=access_changed");
  }

  // Única consulta que depende de outra (precisa do contexto): só roda quando há oportunidade ativa.
  const opportunityContexts = await getConversationOpportunityContexts(context, conversationId);
  const pipelineStages = allStages
    .filter((stage) => stage.workspace_id === conversation.workspace_id)
    .map(({ id, name }) => ({ id, name }));

  return (
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
      assignees={assignees}
      members={members}
    />
  );
}
