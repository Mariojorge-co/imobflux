import { Suspense, type ReactNode } from "react";
import { ConversationsList, type ConversationsEmptyHint } from "@/components/conversations/conversations-list";
import { ConversationsShell } from "@/components/conversations/conversations-shell";
import { ConversationsListSkeleton } from "@/components/conversations/conversations-skeletons";
import { getConversationsInbox } from "@/lib/conversations/data";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getWhatsappChannelStatus } from "@/lib/whatsapp/data";
import { HISTORY_FAILURE_MESSAGE, shouldWarnAboutHistory } from "@/lib/whatsapp/history-status";

type ConversasLayoutProps = {
  children: ReactNode;
};

/**
 * Layout das rotas /conversas e /conversas/[conversationId].
 *
 * A lista de conversas é carregada AQUI, uma vez: o layout não é renderizado de novo quando o usuário troca de
 * conversa (só o painel muda). Antes a lista era buscada de novo, duas vezes, a cada clique. A lista chega por
 * streaming (Suspense), então o painel aparece sem esperar por ela.
 */
export default function ConversasLayout({ children }: ConversasLayoutProps) {
  return (
    <div className="flex h-[calc(100dvh-64px)] w-full flex-col overflow-hidden">
      <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
        <ConversationsShell
          list={(
            <Suspense fallback={<ConversationsListSkeleton />}>
              <ConversationsListLoader />
            </Suspense>
          )}
        >
          {children}
        </ConversationsShell>
      </div>
    </div>
  );
}

async function ConversationsListLoader() {
  // As três leituras são independentes (a do canal só retorna dados para o OWNER, pela RLS).
  const [access, inbox, channel] = await Promise.all([
    requireActiveAccess(),
    getConversationsInbox({ limit: 20 }),
    getWhatsappChannelStatus(),
  ]);

  let emptyHint: ConversationsEmptyHint;
  let historyWarning: string | null = null;
  if (access.role === "owner") {
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

  return <ConversationsList emptyHint={emptyHint} historyWarning={historyWarning} initialCounts={inbox.counts} initialItems={inbox.items} />;
}
