import { MessageCircle } from "lucide-react";
import { getConversationsInbox } from "@/lib/conversations/data";
import {
  ConversationsList,
  type ConversationsEmptyHint,
} from "@/components/conversations/conversations-list";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getWhatsappChannelStatus } from "@/lib/whatsapp/data";
import { HISTORY_FAILURE_MESSAGE, shouldWarnAboutHistory } from "@/lib/whatsapp/history-status";
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
  const [access, inbox] = await Promise.all([
    requireActiveAccess(),
    getConversationsInbox({ limit: 20 }),
  ]);

  let emptyHint: ConversationsEmptyHint;
  let historyWarning: string | null = null;
  if (access.role === "owner") {
    const channel = await getWhatsappChannelStatus();
    if (channel && shouldWarnAboutHistory(channel.historyImport, channel.historyStartedAt)) {
      historyWarning = HISTORY_FAILURE_MESSAGE;
    }
    emptyHint = channel?.status === "active"
      ? {
          title: "WhatsApp conectado. Aguardando mensagens",
          description: "As conversas aparecem aqui assim que alguém escrever para o número conectado ou você enviar a primeira mensagem. O histórico anterior à conexão não é importado.",
        }
      : {
          title: "Conecte seu WhatsApp para começar",
          description: "Leia um QR code com o celular do escritório e as conversas passam a chegar aqui, já com o tempo de resposta de cada cliente.",
          cta: { href: "/configuracoes/whatsapp", label: "Conectar WhatsApp" },
        };
  } else {
    emptyHint = {
      title: "Nenhuma conversa liberada ainda",
      description: "As conversas aparecem aqui quando o WhatsApp do escritório estiver conectado e houver mensagens. Se esperava ver algo, fale com o responsável pela conta.",
    };
  }

  return (
    <div className="flex h-full w-full">
      {/* Coluna esquerda: lista de conversas (320px no desktop, tela cheia no mobile) */}
      <div className="w-full shrink-0 md:w-[19rem] xl:w-80">
        <ConversationsList emptyHint={emptyHint} historyWarning={historyWarning} initialCounts={inbox.counts} initialItems={inbox.items} />
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
