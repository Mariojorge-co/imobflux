import { MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/ui";

/**
 * Rota base /conversas: estado "selecione uma conversa" (a lista vem do layout).
 * No celular a lista ocupa a tela toda e este painel fica oculto.
 */
export default function ConversasPage() {
  return (
    <div className="hidden h-full items-center justify-center bg-background p-section md:flex">
      <EmptyState
        className="max-w-md bg-transparent"
        description="Escolha uma conversa na lista para visualizar o histórico e continuar o atendimento."
        icon={MessageCircle}
        title="Selecione uma conversa"
      />
    </div>
  );
}
