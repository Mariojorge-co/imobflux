import type { LucideIcon } from "lucide-react";
import {
  CalendarClock,
  Clock3,
  MessageCircle,
  TriangleAlert,
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
import {
  priorityClients,
  prioritySummary,
  staleClients,
  todayFollowUps,
} from "@/lib/prioridades-data";
import type { PrioritySummaryId } from "@/types/prioridades";

const summaryIcons = {
  "waiting-response": MessageCircle,
  "today-follow-ups": CalendarClock,
  "stale-clients": Clock3,
  "at-risk": TriangleAlert,
} satisfies Record<PrioritySummaryId, LucideIcon>;

const [featuredSummary, ...remainingSummary] = prioritySummary;

export default function PrioridadesPage() {
  return (
    <PageContainer>
      <PageHeader
        description="Veja quem precisa da sua atenção e qual deve ser a próxima ação."
        title="Prioridades"
      />

      <section aria-labelledby="resumo-do-dia" className="space-y-stack">
        <SectionTitle id="resumo-do-dia">Resumo do dia</SectionTitle>
        <div className="grid gap-stack xl:grid-cols-[minmax(17rem,1.35fr)_minmax(0,3fr)]">
          <SummaryCard
            context={featuredSummary.context}
            featured
            icon={summaryIcons[featuredSummary.id]}
            title={featuredSummary.title}
            value={featuredSummary.value}
          />
          <div className="grid grid-cols-2 gap-stack lg:grid-cols-3">
            {remainingSummary.map((item) => (
              <SummaryCard
                className="last:col-span-2 lg:last:col-span-1"
                context={item.context}
                icon={summaryIcons[item.id]}
                key={item.id}
                title={item.title}
                value={item.value}
              />
            ))}
          </div>
        </div>
      </section>

      <section
        aria-labelledby="precisam-de-atencao"
        className="space-y-stack"
      >
        <SectionTitle id="precisam-de-atencao">
          Precisam de atenção agora
        </SectionTitle>
        <Card className="divide-y divide-border overflow-hidden" padding="none">
          {priorityClients.map((client) => (
            <PriorityClientItem client={client} key={client.id} />
          ))}
        </Card>
      </section>

      <div className="grid gap-section lg:grid-cols-2">
        <section aria-labelledby="follow-ups-de-hoje" className="space-y-stack">
          <SectionTitle id="follow-ups-de-hoje">
            Follow-ups de hoje
          </SectionTitle>
          <Card
            className="divide-y divide-border overflow-hidden"
            padding="none"
          >
            {todayFollowUps.map((client) => (
              <CompactClientItem client={client} key={client.id} />
            ))}
          </Card>
        </section>

        <section aria-labelledby="sem-contato-recente" className="space-y-stack">
          <SectionTitle id="sem-contato-recente">
            Sem contato recente
          </SectionTitle>
          <Card
            className="divide-y divide-border overflow-hidden"
            padding="none"
          >
            {staleClients.map((client) => (
              <CompactClientItem client={client} key={client.id} />
            ))}
          </Card>
        </section>
      </div>
    </PageContainer>
  );
}
