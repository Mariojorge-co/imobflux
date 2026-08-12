import type { LucideIcon } from "lucide-react";
import {
  Clock3,
  TriangleAlert,
  UserRoundX,
  UserPlus,
  MessageSquareWarning,
  Hourglass,
} from "lucide-react";
import {
  Card,
  PageContainer,
  PageHeader,
  SectionTitle,
} from "@/components/ui";
import {
  CompactClientItem,
  FollowupPriorityItem,
  PriorityClientItem,
  SummaryCard,
} from "@/components/prioridades";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getPrioridadesDashboard } from "@/lib/prioridades/data";
import { getConversationsList } from "@/lib/conversations/data";
import { calculateSLA } from "@/lib/conversations/sla";
import type { PriorityClient, PrioritySummaryId } from "@/types/prioridades";

const summaryIcons = {
  "pending-qualification": TriangleAlert,
  "without-phone": UserRoundX,
  "stale-leads": Clock3,
  "new-contacts": UserPlus,
} satisfies Record<PrioritySummaryId, LucideIcon>;

export default async function PrioridadesPage() {
  await requireActiveAccess();
  const [data, conversations] = await Promise.all([
    getPrioridadesDashboard(),
    getConversationsList({ limit: 50 }),
  ]);

  // Separação operacional estrita: EQUIPE DEVENDO RESPOSTA vs AGUARDANDO CLIENTE
  const teamWaitingClients: PriorityClient[] = [];
  const clientWaitingClients: PriorityClient[] = [];

  for (const conv of conversations) {
    const sla = calculateSLA(conv.last_msg_direction, conv.last_activity_at);
    if (!sla) continue;

    const clientObj: PriorityClient = {
      id: conv.contact_id || conv.conversation_id,
      display_name: conv.participant_name || "Contato",
      classification: "lead",
      created_at: conv.started_at,
      updated_at: conv.last_activity_at,
      conversation_id: conv.conversation_id,
      sla_text: sla.badgeText,
      sla_level: sla.level,
    };

    if (sla.type === "team_waiting") {
      teamWaitingClients.push(clientObj);
    } else if (sla.type === "client_waiting" && sla.minutesWaiting >= 24 * 60) {
      clientWaitingClients.push(clientObj);
    }
  }

  const oldestFirst = (left: PriorityClient, right: PriorityClient) =>
    left.updated_at.localeCompare(right.updated_at)
    || (left.conversation_id ?? left.id).localeCompare(right.conversation_id ?? right.id);

  teamWaitingClients.sort(oldestFirst);
  clientWaitingClients.sort(oldestFirst);

  const dueFollowups = data.due_followups;

  return (
    <PageContainer>
      <PageHeader
        description="Acompanhe imediatamente quem está aguardando atendimento da equipe e os clientes em follow-up."
        title="Prioridades Operacionais"
      />

      {/* DUAS COLUNAS LADO A LADO NO DESKTOP: EQUIPE DEVENDO RESPOSTA (ESQUERDA) VS AGUARDANDO CLIENTE (DIREITA) */}
      <div className="grid gap-6 md:grid-cols-2 items-start">
        {/* COLUNA ESQUERDA: EQUIPE DEVENDO RESPOSTA (URGENTE) */}
        <section aria-labelledby="equipe-devendo" className="space-y-3">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-base">
            <MessageSquareWarning size={20} />
            <SectionTitle id="equipe-devendo">
              Equipe Devendo Resposta ({teamWaitingClients.length})
            </SectionTitle>
          </div>

          {teamWaitingClients.length === 0 ? (
            <p className="text-sm text-text-muted">
              Nenhum cliente aguardando resposta no momento. Parabéns!
            </p>
          ) : (
            <Card className="divide-y divide-border overflow-hidden border-rose-500/30" padding="none">
              {teamWaitingClients.map((client) => (
                <PriorityClientItem
                  client={client}
                  key={client.id}
                  labelOverride="Última mensagem do cliente"
                />
              ))}
            </Card>
          )}
        </section>

        {/* COLUNA DIREITA: AGUARDANDO CLIENTE / FOLLOW-UP */}
        <section aria-labelledby="aguardando-cliente" className="space-y-3">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 font-semibold text-base">
            <Hourglass size={20} />
            <SectionTitle id="aguardando-cliente">
              Aguardando Cliente / Follow-up ({clientWaitingClients.length})
            </SectionTitle>
          </div>

          {clientWaitingClients.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhum cliente em aguardo registrado.</p>
          ) : (
            <Card className="divide-y divide-border overflow-hidden" padding="none">
              {clientWaitingClients.map((client) => (
                <PriorityClientItem
                  client={client}
                  key={client.id}
                  labelOverride="Mensagem enviada pela equipe"
                />
              ))}
            </Card>
          )}
        </section>
      </div>

      <section aria-labelledby="followups-devidos" className="space-y-3">
        <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
          <Clock3 size={20} />
          <SectionTitle id="followups-devidos">Follow-ups devidos ({dueFollowups.length})</SectionTitle>
        </div>
        {dueFollowups.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhum follow-up devido no momento.</p>
        ) : (
          <Card className="divide-y divide-border overflow-hidden" padding="none">
            {dueFollowups.map((followup) => (
              <FollowupPriorityItem followup={followup} key={followup.id} />
            ))}
          </Card>
        )}
      </section>

      {/* SEÇÃO 3: RESUMO DE PENDÊNCIAS OBJETIVAS */}
      <section aria-labelledby="resumo-do-dia" className="space-y-stack pt-4">
        <SectionTitle id="resumo-do-dia">Pendências de Cadastro e Qualificação</SectionTitle>
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

      {/* SEÇÃO 4: OUTRAS PENDÊNCIAS DE CADASTRO */}
      <div className="grid gap-section lg:grid-cols-2">
        <section aria-labelledby="sem-telefone" className="space-y-stack">
          <SectionTitle id="sem-telefone">
            Sem telefone cadastrado
          </SectionTitle>
          {data.without_phone.items.length === 0 ? (
            <p className="text-body text-text-muted">Nenhuma pendência encontrada.</p>
          ) : (
            <Card className="divide-y divide-border overflow-hidden" padding="none">
              {data.without_phone.items.map((client) => (
                <CompactClientItem
                  client={client}
                  key={client.id}
                  labelOverride="Cadastro sem revisão desde"
                />
              ))}
            </Card>
          )}
        </section>

        <section aria-labelledby="pendentes-qualificacao" className="space-y-stack">
          <SectionTitle id="pendentes-qualificacao">
            Pendentes de qualificação
          </SectionTitle>
          {data.pending_qualification.items.length === 0 ? (
            <p className="text-body text-text-muted">Nenhuma pendência encontrada.</p>
          ) : (
            <Card className="divide-y divide-border overflow-hidden" padding="none">
              {data.pending_qualification.items.map((client) => (
                <CompactClientItem
                  client={client}
                  key={client.id}
                  labelOverride="Aguardando desde"
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
