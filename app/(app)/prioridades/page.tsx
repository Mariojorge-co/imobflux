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
  EmptyState,
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
import { getSlaConversations } from "@/lib/conversations/sla-conversations-data";
import { getSlaSettings } from "@/lib/conversations/sla-settings-data";
import { calculateSLA, formatLimit } from "@/lib/conversations/sla";
import type { PriorityClient, PrioritySummaryId } from "@/types/prioridades";

const summaryIcons = {
  "pending-qualification": TriangleAlert,
  "without-phone": UserRoundX,
  "stale-leads": Clock3,
  "new-contacts": UserPlus,
} satisfies Record<PrioritySummaryId, LucideIcon>;

export default async function PrioridadesPage() {
  await requireActiveAccess();
  const [data, slaConversations, settings] = await Promise.all([
    getPrioridadesDashboard(),
    getSlaConversations(),
    getSlaSettings(),
  ]);

  // Separação operacional estrita: EQUIPE DEVENDO RESPOSTA vs AGUARDANDO CLIENTE (follow-up).
  // O banco já deixou de fora grupos, conversa consigo mesmo, encerradas e conversas com prazo pausado/desativado.
  const teamWaitingClients: PriorityClient[] = [];
  const followupGroups: Array<{ level: 1 | 2 | 3; clients: PriorityClient[] }> = [
    { level: 3, clients: [] },
    { level: 2, clients: [] },
    { level: 1, clients: [] },
  ];

  for (const conv of slaConversations) {
    const sla = calculateSLA(conv.sla_direction, conv.sla_at, settings);
    if (!sla) continue;

    const clientObj: PriorityClient = {
      id: conv.contact_id || conv.conversation_id,
      display_name: conv.participant_name || "Contato",
      classification: "lead",
      created_at: conv.started_at,
      updated_at: conv.sla_at,
      conversation_id: conv.conversation_id,
      sla_text: sla.badgeText,
      sla_level: sla.level,
    };

    if (sla.type === "team_waiting") {
      teamWaitingClients.push(clientObj);
    } else if (sla.followupLevel >= 1) {
      // O painel só mostra conversas que já passaram do 1º nível de follow-up configurado.
      followupGroups.find((group) => group.level === sla.followupLevel)?.clients.push(clientObj);
    }
  }

  const oldestFirst = (left: PriorityClient, right: PriorityClient) =>
    left.updated_at.localeCompare(right.updated_at)
    || (left.conversation_id ?? left.id).localeCompare(right.conversation_id ?? right.id);

  teamWaitingClients.sort(oldestFirst);
  for (const group of followupGroups) group.clients.sort(oldestFirst);
  const clientWaitingCount = followupGroups.reduce((total, group) => total + group.clients.length, 0);
  const followupLimits: Record<1 | 2 | 3, number> = { 1: settings.followup1, 2: settings.followup2, 3: settings.followup3 };
  const followupTitle: Record<1 | 2 | 3, string> = { 1: "Atenção", 2: "Atrasado", 3: "Muito atrasado" };

  const dueFollowups = data.due_followups;

  return (
    <PageContainer className="space-y-6 overflow-x-clip">
      <PageHeader
        description="Acompanhe imediatamente quem está aguardando atendimento da equipe e os clientes em follow-up."
        title="Prioridades Operacionais"
      />

      {/* DUAS COLUNAS LADO A LADO NO DESKTOP: EQUIPE DEVENDO RESPOSTA (ESQUERDA) VS AGUARDANDO CLIENTE (DIREITA) */}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        {/* COLUNA ESQUERDA: EQUIPE DEVENDO RESPOSTA (URGENTE) */}
        <section aria-labelledby="equipe-devendo" className="space-y-3">
          <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-base">
            <MessageSquareWarning size={20} />
            <SectionTitle id="equipe-devendo">
              Equipe Devendo Resposta ({teamWaitingClients.length})
            </SectionTitle>
          </div>

          {teamWaitingClients.length === 0 ? (
            <EmptyState className="items-start p-4 text-left" description="A equipe está em dia com as respostas." icon={MessageSquareWarning} title="Nenhum cliente aguardando" />
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
              Aguardando Cliente / Follow-up ({clientWaitingCount})
            </SectionTitle>
          </div>

          {clientWaitingCount === 0 ? (
            <EmptyState
              className="items-start p-4 text-left"
              description={`Nenhuma conversa parada há mais de ${formatLimit(settings.followup1)}.`}
              icon={Hourglass}
              title="Nenhum cliente em espera"
            />
          ) : (
            <div className="space-y-3">
              {followupGroups.filter((group) => group.clients.length > 0).map((group) => (
                <div data-testid={`followup-level-${group.level}`} key={group.level}>
                  <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-text-muted">
                    {followupTitle[group.level]} · mais de {formatLimit(followupLimits[group.level])} ({group.clients.length})
                  </p>
                  <Card className="divide-y divide-border overflow-hidden" padding="none">
                    {group.clients.map((client) => (
                      <PriorityClientItem
                        client={client}
                        key={client.id}
                        labelOverride="Mensagem enviada pela equipe"
                      />
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="followups-devidos" className="space-y-3">
        <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
          <Clock3 size={20} />
          <SectionTitle id="followups-devidos">Follow-ups devidos ({dueFollowups.length})</SectionTitle>
        </div>
        {dueFollowups.length === 0 ? (
          <EmptyState className="items-start p-4 text-left" description="Não há ações vencidas ou previstas para agora." icon={Clock3} title="Nenhum follow-up devido" />
        ) : (
          <Card className="divide-y divide-border overflow-hidden" padding="none">
            {dueFollowups.map((followup) => (
              <FollowupPriorityItem followup={followup} key={followup.id} />
            ))}
          </Card>
        )}
      </section>

      {/* SEÇÃO 3: RESUMO DE PENDÊNCIAS OBJETIVAS */}
      <section aria-labelledby="resumo-do-dia" className="space-y-3">
        <SectionTitle id="resumo-do-dia">Pendências de Cadastro e Qualificação</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
      <div className="grid gap-6 lg:grid-cols-2">
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
