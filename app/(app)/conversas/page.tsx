import { MessageCircle } from "lucide-react";
import { getConversationsInbox } from "@/lib/conversations/data";
import { ConversationsList } from "@/components/conversations/conversations-list";
import { EmptyState } from "@/components/ui";

/**
 * Rota base /conversas — Server Component.
 *
 * Estrutura responsiva com layout de duas colunas:
 * - Desktop (md+): coluna esquerda = lista; coluna direita = estado vazio
 *   ("Selecione uma conversa").
 * - Mobile (<md): somente a lista de conversas ocupa a tela; a coluna direita
 *   é ocultada via CSS. A navegação para /conversas/[id] exibe o detalhe.
 */
export default async function ConversasPage() {
  const inbox = await getConversationsInbox({ limit: 20 });

  return (
    <div className="flex h-full w-full">
      {/* Coluna esquerda: lista de conversas (320px no desktop, tela cheia no mobile) */}
      <div className="w-full shrink-0 md:w-[19rem] xl:w-80">
        <ConversationsList initialCounts={inbox.counts} initialItems={inbox.items} />
      </div>

      {/* Coluna direita: estado "selecione uma conversa" — oculta no mobile */}
      <div className="hidden flex-1 items-center justify-center bg-background p-section md:flex">
        <EmptyState
          className="max-w-md bg-transparent"
          description="Escolha uma conversa na lista para visualizar o histórico e continuar o atendimento."
          icon={MessageCircle}
          title="Selecione uma conversa"
        />
      </div>
    </div>
  );
}
