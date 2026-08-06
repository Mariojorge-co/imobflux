import { MessageCircle } from "lucide-react";
import { getConversationsList } from "@/lib/conversations/data";
import { ConversationsList } from "@/components/conversations/conversations-list";

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
  const initialItems = await getConversationsList({ limit: 20 });

  return (
    <div className="flex h-full w-full">
      {/* Coluna esquerda: lista de conversas (320px no desktop, tela cheia no mobile) */}
      <div className="w-full shrink-0 md:w-80">
        <ConversationsList initialItems={initialItems} />
      </div>

      {/* Coluna direita: estado "selecione uma conversa" — oculta no mobile */}
      <div className="hidden flex-1 flex-col items-center justify-center gap-4 bg-background md:flex">
        <MessageCircle
          aria-hidden="true"
          className="text-text-muted"
          size={48}
          strokeWidth={1.2}
        />
        <div className="text-center">
          <p className="text-sm font-medium text-text">
            Selecione uma conversa
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Escolha uma conversa na lista para visualizar o histórico.
          </p>
        </div>
      </div>
    </div>
  );
}
