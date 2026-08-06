import type { LucideIcon } from "lucide-react";
import {
  Clock3,
  TriangleAlert,
  UserRoundX,
  UserPlus,
} from "lucide-react";
import {
  Card,
  PageContainer,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import {
  CompactClientItem,
  PriorityClientItem,
  SummaryCard,
} from "@/components/prioridades";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getPrioridadesDashboard } from "@/lib/prioridades/data";
import type { PrioritySummaryId } from "@/types/prioridades";

const summaryIcons = {
  "pending-qualification": TriangleAlert,
  "without-phone": UserRoundX,
  "stale-leads": Clock3,
  "new-contacts": UserPlus,
} satisfies Record<PrioritySummaryId, LucideIcon>;

export default async function PrioridadesPage() {
  await requireActiveAccess(); // O workspace_id é definido no nível do PostgreSQL pela sessão
  const data = await getPrioridadesDashboard();

  return (
    <PageContainer>
      <PageHeader
        description="Veja quem precisa da sua atenção (Nota: um mesmo contato pode aparecer em múltiplas categorias)."
        title="Prioridades"
      />

      <section aria-labelledby="resumo-do-dia" className="space-y-stack">
        <SectionTitle id="resumo-do-dia">Pendências objetivas</SectionTitle>
        <div className="grid gap-stack sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            context="Aguardando qualificação inicial"
            icon={summaryIcons["pending-qualification"]}
            title="Pendentes de qualificação"
            value={data.pending_qualification.count}
          />
          <SummaryCard
            context="Sem meio de contato rápido"
            icon={summaryIcons["without-phone"]}
            title="Sem telefone"
            value={data.without_phone.count}
          />
          <SummaryCard
            context="Cadastro sem revisão há > 15 dias"
            icon={summaryIcons["stale-leads"]}
            title="Leads sem revisão recente"
            value={data.stale_leads.count}
          />
          <SummaryCard
            context="Criados nos últimos 7 dias"
            icon={summaryIcons["new-contacts"]}
            title="Novos nos últimos 7 dias"
            value={data.new_contacts.count}
          />
        </div>
      </section>

      <section
        aria-labelledby="sem-telefone"
        className="space-y-stack"
      >
        <SectionTitle id="sem-telefone">
          Sem telefone cadastrado
        </SectionTitle>
        {data.without_phone.items.length === 0 ? (
          <p className="text-body text-text-muted">Nenhuma pendência encontrada.</p>
        ) : (
          <Card className="divide-y divide-border overflow-hidden" padding="none">
            {data.without_phone.items.map((client) => (
              <PriorityClientItem 
                client={client} 
                key={client.id} 
                labelOverride="Cadastro sem revisão desde" 
              />
            ))}
          </Card>
        )}
      </section>

      <section
        aria-labelledby="pendentes-qualificacao"
        className="space-y-stack"
      >
        <SectionTitle id="pendentes-qualificacao">
          Pendentes de qualificação
        </SectionTitle>
        {data.pending_qualification.items.length === 0 ? (
          <p className="text-body text-text-muted">Nenhuma pendência encontrada.</p>
        ) : (
          <Card className="divide-y divide-border overflow-hidden" padding="none">
            {data.pending_qualification.items.map((client) => (
              <PriorityClientItem 
                client={client} 
                key={client.id} 
                labelOverride="Aguardando desde"
                useCreatedAt 
              />
            ))}
          </Card>
        )}
      </section>

      <div className="grid gap-section lg:grid-cols-2">
        <section aria-labelledby="leads-sem-revisao" className="space-y-stack">
          <SectionTitle id="leads-sem-revisao">
            Leads sem revisão recente
          </SectionTitle>
          {data.stale_leads.items.length === 0 ? (
            <p className="text-body text-text-muted">Nenhuma pendência encontrada.</p>
          ) : (
            <Card
              className="divide-y divide-border overflow-hidden"
              padding="none"
            >
              {data.stale_leads.items.map((client) => (
                <CompactClientItem 
                  client={client} 
                  key={client.id} 
                  labelOverride="Cadastro estagnado desde"
                />
              ))}
            </Card>
          )}
        </section>

        <section aria-labelledby="novos-contatos" className="space-y-stack">
          <SectionTitle id="novos-contatos">
            Novos nos últimos 7 dias
          </SectionTitle>
          {data.new_contacts.items.length === 0 ? (
            <p className="text-body text-text-muted">Nenhuma pendência encontrada.</p>
          ) : (
            <Card
              className="divide-y divide-border overflow-hidden"
              padding="none"
            >
              {data.new_contacts.items.map((client) => (
                <CompactClientItem 
                  client={client} 
                  key={client.id}
                  labelOverride="Criado"
                  useCreatedAt
                />
              ))}
            </Card>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
