import Link from "next/link";
import { Download, MessagesSquare, ScrollText, Smartphone, Timer, Users, Zap } from "lucide-react";
import {
  Card,
  PageContainer,
  PageHeader,
} from "@/components/ui";
import { requireOwnerAccess } from "@/lib/auth/dal";

export default async function ConfiguracoesPage() {
  await requireOwnerAccess();

  return (
    <PageContainer>
      <PageHeader title="Configurações" />
      <section aria-label="Áreas de Configurações" className="space-y-stack">
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/whatsapp">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <Smartphone aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">WhatsApp</span>
              <span className="text-body text-text-muted">Conecte o número da imobiliária lendo um QR code.</span>
            </span>
          </Card>
        </Link>
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/equipe">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <Users aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">Equipe</span>
              <span className="text-body text-text-muted">Convide, desative e reative funcionários.</span>
            </span>
          </Card>
        </Link>
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/respostas-rapidas">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <Zap aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">Respostas rápidas</span>
              <span className="text-body text-text-muted">Modelos de mensagem da equipe, com categorias e variáveis.</span>
            </span>
          </Card>
        </Link>
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/prazos">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <Timer aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">Prazos</span>
              <span className="text-body text-text-muted">Defina quando uma conversa muda de cor e entra em Hoje.</span>
            </span>
          </Card>
        </Link>
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/grupos">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <MessagesSquare aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">Grupos</span>
              <span className="text-body text-text-muted">Veja os grupos do WhatsApp e libere, um a um, para a equipe.</span>
            </span>
          </Card>
        </Link>
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/auditoria">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <ScrollText aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">Auditoria</span>
              <span className="text-body text-text-muted">Veja quem fez o quê nas ações sensíveis.</span>
            </span>
          </Card>
        </Link>
        <Link className="block max-w-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href="/configuracoes/exportacao">
          <Card className="flex items-center gap-stack transition-colors hover:bg-neutral-soft">
            <span className="flex size-11 items-center justify-center rounded-control bg-neutral-soft text-text">
              <Download aria-hidden="true" size={20} />
            </span>
            <span>
              <span className="block font-semibold text-text">Exportar dados</span>
              <span className="text-body text-text-muted">Baixe contatos e oportunidades em planilha (CSV).</span>
            </span>
          </Card>
        </Link>
      </section>
    </PageContainer>
  );
}
