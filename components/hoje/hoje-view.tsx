import Link from "next/link";
import { AlertCircle, CalendarCheck, ChevronDown, ClipboardList, Clock3, Hourglass, ListChecks, MessageCircleWarning, TriangleAlert, UserPlus, UserRoundX, type LucideIcon } from "lucide-react";
import { Avatar, Card, EmptyState, SectionTitle } from "@/components/ui";
import { CompactClientItem, FollowupPriorityItem, SummaryCard } from "@/components/prioridades";
import { LimitedList } from "@/components/hoje/limited-list";
import { classNames } from "@/lib/class-names";
import { SLA_TONE_CLASS, describeSla } from "@/lib/conversations/sla-display";
import { formatLimit, type SLAInfo, type SlaSettings } from "@/lib/conversations/sla";
import {
  FILTER_ALL,
  FILTER_UNASSIGNED,
  countActionTargets,
  filterToParam,
  type DueFollowup,
  type AttendantFilter,
  type TodayConversation,
  type TodayConversationItem,
  type TodayView,
} from "@/lib/hoje/model";
import type { PrioridadesDashboardResult, PriorityClient } from "@/types/prioridades";
import { PRIORITY_LABELS, type WorkTask } from "@/lib/tasks/model";

function SlaChip({ sla }: { sla: SLAInfo }) {
  const display = describeSla(sla);
  if (!display) return null;
  const Icon = display.teamWaiting ? (display.urgent ? AlertCircle : MessageCircleWarning) : Hourglass;
  return (
    <span
      className={classNames(
        "inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-0.5 text-caption font-medium",
        SLA_TONE_CLASS[display.tone],
      )}
      data-sla-tone={display.tone}
      title={display.fullLabel}
    >
      <Icon aria-hidden="true" size={12} />
      {display.fullLabel}
    </span>
  );
}

function assigneeText(conversation: TodayConversation): string {
  if (conversation.assignees.length === 0) return "Sem responsável";
  return conversation.assignees.map((assignee) => assignee.display_name || "Membro").join(", ");
}

function ConversationRow({ item, showAssignee }: { item: TodayConversationItem; showAssignee: boolean }) {
  const { conversation, sla } = item;
  const name = conversation.participant_name || "Contato";
  return (
    <li>
      <Link
        aria-label={`Abrir conversa com ${name}`}
        className="flex min-h-11 items-start gap-3 px-3 py-2.5 transition-colors hover:bg-neutral-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="hoje-conversation"
        href={`/conversas/${conversation.conversation_id}`}
      >
        <Avatar className="mt-0.5" name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">{name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <SlaChip sla={sla} />
            {showAssignee ? <span className="text-caption text-text-muted">{assigneeText(conversation)}</span> : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

function formatDue(iso: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone ?? undefined,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function TaskRow({ task, timezone }: { task: WorkTask; timezone: string | null }) {
  const href = task.conversation_id ? `/conversas/${task.conversation_id}` : "/tarefas";
  return (
    <li>
      <Link
        className="flex min-h-11 items-start gap-3 px-3 py-2.5 transition-colors hover:bg-neutral-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="hoje-task"
        href={href}
      >
        <ListChecks aria-hidden="true" className="mt-0.5 shrink-0 text-text-muted" size={18} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text">{task.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-caption text-text-muted">
            <span className={task.is_overdue ? "font-semibold text-danger" : undefined}>
              {task.is_overdue ? "Atrasada · " : "Para "}
              {formatDue(task.due_at, timezone)}
            </span>
            {task.contact_name ? <span className="truncate">{task.contact_name}</span> : null}
            <span>{PRIORITY_LABELS[task.priority]}</span>
          </p>
        </div>
      </Link>
    </li>
  );
}

function Section({
  title,
  count,
  testId,
  empty,
  icon: Icon,
  tone = "default",
  children,
}: {
  title: string;
  count: number;
  testId: string;
  empty: string;
  icon: LucideIcon;
  tone?: "default" | "urgent";
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} data-testid={testId}>
      <div className="mb-2 flex items-center gap-2">
        <Icon aria-hidden="true" className={tone === "urgent" ? "text-danger" : "text-text-muted"} size={18} />
        <SectionTitle>{title}</SectionTitle>
        <span className="rounded-pill bg-neutral-soft px-2 py-0.5 text-caption font-medium text-text-muted" data-testid={`${testId}-count`}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <Card className="text-body text-text-muted">{empty}</Card>
      ) : (
        <Card className="overflow-hidden" padding="none">
          {children}
        </Card>
      )}
    </section>
  );
}

function Counter({ label, value, testId, className }: { label: string; value: number; testId: string; className?: string }) {
  return (
    <Card className={classNames("min-w-0", className)} data-testid={testId}>
      <p className="text-caption text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text">{value}</p>
    </Card>
  );
}

export function AttendantFilterBar({
  filter,
  members,
}: {
  filter: AttendantFilter;
  members: Array<{ member_id: string; display_name: string }>;
}) {
  const current = filterToParam(filter);
  const options = [
    { value: FILTER_ALL, label: "Toda a equipe" },
    { value: FILTER_UNASSIGNED, label: "Sem responsável" },
    ...members.map((member) => ({ value: member.member_id, label: member.display_name })),
  ];
  return (
    <nav aria-label="Filtrar por responsável" className="flex flex-wrap gap-2" data-testid="hoje-filter">
      {options.map((option) => (
        <Link
          aria-current={current === option.value ? "true" : undefined}
          className={classNames(
            "inline-flex min-h-11 items-center rounded-pill border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-9",
            current === option.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-surface text-text-muted hover:bg-neutral-soft hover:text-text",
          )}
          href={option.value === FILTER_ALL ? "/hoje" : `/hoje?atendente=${encodeURIComponent(option.value)}`}
          key={option.value}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

const FOLLOWUP_TITLE: Record<1 | 2 | 3, string> = { 1: "Atenção", 2: "Atrasado", 3: "Muito atrasado" };

function NewUnattendedRow({ conversation, timezone }: { conversation: TodayConversation; timezone: string | null }) {
  return (
    <li>
      <Link
        aria-label={`Abrir conversa com ${conversation.participant_name || "Contato"}`}
        className="flex min-h-11 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-neutral-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        data-testid="hoje-new-item"
        href={`/conversas/${conversation.conversation_id}`}
      >
        <UserPlus aria-hidden="true" className="shrink-0 text-text-muted" size={18} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{conversation.participant_name || "Contato"}</span>
        <span className="text-caption text-text-muted">{formatDue(conversation.started_at, timezone)}</span>
      </Link>
    </li>
  );
}

function HygieneList({
  title,
  testId,
  clients,
  count,
  label,
  useCreatedAt,
}: {
  title: string;
  testId: string;
  clients: PriorityClient[];
  count: number;
  label: string;
  useCreatedAt?: boolean;
}) {
  return (
    <div data-testid={testId}>
      <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-text-muted">
        {title} ({count})
      </p>
      {clients.length === 0 ? (
        <Card className="text-body text-text-muted">Nenhuma pendência encontrada.</Card>
      ) : (
        <Card className="overflow-hidden" padding="none">
          <LimitedList as="div" className="divide-y divide-border">
            {clients.map((client) => (
              <CompactClientItem client={client} key={client.id} labelOverride={label} useCreatedAt={useCreatedAt} />
            ))}
          </LimitedList>
        </Card>
      )}
    </div>
  );
}

export type HojeViewProps = {
  view: TodayView;
  timezone: string | null;
  showAssignee: boolean;
  dueFollowups: DueFollowup[];
  hygiene: Pick<PrioridadesDashboardResult, "new_contacts" | "pending_qualification" | "stale_leads" | "without_phone">;
  settings: SlaSettings;
};

export function HojeView({ view, timezone, showAssignee, dueFollowups, hygiene, settings }: HojeViewProps) {
  const { counters } = view;
  const actionCount = countActionTargets(view, dueFollowups);
  const awaitingClient = view.followups.length;
  const hygieneTotal =
    hygiene.pending_qualification.count + hygiene.without_phone.count + hygiene.stale_leads.count + hygiene.new_contacts.count;
  const nothing = actionCount === 0;
  const limits: Record<1 | 2 | 3, number> = { 1: settings.followup1, 2: settings.followup2, 3: settings.followup3 };
  const awaitingGroups = ([3, 2, 1] as const)
    .map((level) => ({ level, items: view.followups.filter((item) => item.sla.followupLevel === level) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-section">
      {/* 1. Contadores do dia. "Para agir agora" conta cada pessoa uma vez só, mesmo em várias seções. */}
      <div className="grid grid-cols-2 gap-stack lg:grid-cols-5" data-testid="hoje-counters">
        <Counter className="col-span-2 lg:col-span-1" label="Para agir agora" testId="hoje-counter-action" value={actionCount} />
        <Counter label="Recebidas hoje" testId="hoje-counter-incoming" value={counters.incoming_today} />
        <Counter label="Enviadas hoje" testId="hoje-counter-outgoing" value={counters.outgoing_today} />
        <Counter label="Conversas novas" testId="hoje-counter-new" value={counters.new_conversations_today} />
        <Counter label="Tarefas concluídas" testId="hoje-counter-tasks" value={counters.tasks_completed_today} />
      </div>

      {nothing ? (
        <EmptyState
          description="Não há conversas esperando, follow-ups nem tarefas para hoje. Quando algo precisar da sua atenção, aparece aqui."
          icon={CalendarCheck}
          title="Nada pendente por agora"
        />
      ) : null}

      <div className="space-y-section" data-testid="hoje-sections">
        {/* 2. A equipe está devendo resposta */}
        <Section
          count={view.waiting.length}
          empty="Nenhum cliente esperando resposta. A equipe está em dia."
          icon={MessageCircleWarning}
          testId="hoje-waiting"
          title="Clientes aguardando resposta da equipe"
          tone="urgent"
        >
          <LimitedList className="divide-y divide-border">
            {view.waiting.map((item) => (
              <ConversationRow item={item} key={item.conversation.conversation_id} showAssignee={showAssignee} />
            ))}
          </LimitedList>
        </Section>

        {/* 3. Follow-ups devidos (ações marcadas que venceram ou vencem hoje) */}
        <Section
          count={dueFollowups.length}
          empty="Nenhum follow-up devido. Não há ações vencidas ou previstas para agora."
          icon={Clock3}
          testId="hoje-due-followups"
          title="Follow-ups devidos"
        >
          <LimitedList as="div" className="divide-y divide-border">
            {dueFollowups.map((followup) => (
              <FollowupPriorityItem followup={followup} key={followup.id} />
            ))}
          </LimitedList>
        </Section>

        {/* 4. Tarefas de hoje e atrasadas */}
        <Section count={view.tasks.length} empty="Nenhuma tarefa para hoje." icon={ListChecks} testId="hoje-tasks" title="Tarefas de hoje e atrasadas">
          <LimitedList className="divide-y divide-border">
            {view.tasks.map((task) => (
              <TaskRow key={task.id} task={task} timezone={timezone} />
            ))}
          </LimitedList>
        </Section>

        {/* 5. Novas conversas sem atendimento */}
        <Section
          count={view.newUnattended.length}
          empty="Nenhuma conversa nova sem atendimento."
          icon={UserPlus}
          testId="hoje-new"
          title="Novas conversas sem atendimento"
        >
          <LimitedList className="divide-y divide-border">
            {view.newUnattended.map((conversation) => (
              <NewUnattendedRow conversation={conversation} key={conversation.conversation_id} timezone={timezone} />
            ))}
          </LimitedList>
        </Section>

        {/* 6. Aguardando cliente (a bola está com o cliente) */}
        <Section
          count={awaitingClient}
          empty={`Nenhum cliente em espera. Nenhuma conversa parada há mais de ${formatLimit(settings.followup1)}.`}
          icon={Hourglass}
          testId="hoje-awaiting-client"
          title="Aguardando cliente"
        >
          <div className="divide-y divide-border">
            {awaitingGroups.map((group) => (
              <div data-testid={`followup-level-${group.level}`} key={group.level}>
                <p className="bg-neutral-soft/40 px-3 py-1.5 text-caption font-semibold uppercase tracking-wide text-text-muted">
                  {FOLLOWUP_TITLE[group.level]} · mais de {formatLimit(limits[group.level])} ({group.items.length})
                </p>
                <LimitedList className="divide-y divide-border">
                  {group.items.map((item) => (
                    <ConversationRow item={item} key={item.conversation.conversation_id} showAssignee={showAssignee} />
                  ))}
                </LimitedList>
              </div>
            ))}
          </div>
        </Section>

        {/* 7. Higiene de cadastro: por último e recolhida */}
        <section aria-label="Higiene de cadastro" data-testid="hoje-hygiene">
          <details className="group rounded-card border border-border bg-surface" data-testid="hoje-hygiene-details">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
              <ClipboardList aria-hidden="true" className="text-text-muted" size={18} />
              <SectionTitle>Higiene de cadastro</SectionTitle>
              <span
                className="rounded-pill bg-neutral-soft px-2 py-0.5 text-caption font-medium text-text-muted"
                data-testid="hoje-hygiene-count"
              >
                {hygieneTotal}
              </span>
              <ChevronDown aria-hidden="true" className="ml-auto text-text-muted transition-transform group-open:rotate-180" size={18} />
            </summary>
            <div className="space-y-section border-t border-border p-3">
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <SummaryCard
                  context="Aguardando qualificação inicial"
                  icon={TriangleAlert}
                  title="Pendentes de qualificação"
                  value={hygiene.pending_qualification.count}
                />
                <SummaryCard context="Sem meio de contato rápido" icon={UserRoundX} title="Sem telefone" value={hygiene.without_phone.count} />
                <SummaryCard
                  context="Cadastro sem revisão há > 15 dias"
                  icon={Clock3}
                  title="Leads sem revisão recente"
                  value={hygiene.stale_leads.count}
                />
                <SummaryCard context="Criados nos últimos 7 dias" icon={UserPlus} title="Novos nos últimos 7 dias" value={hygiene.new_contacts.count} />
              </div>
              <div className="grid gap-section lg:grid-cols-2">
                <HygieneList
                  clients={hygiene.pending_qualification.items}
                  count={hygiene.pending_qualification.count}
                  label="Aguardando desde"
                  testId="hoje-hygiene-pending"
                  title="Pendentes de qualificação"
                  useCreatedAt
                />
                <HygieneList
                  clients={hygiene.without_phone.items}
                  count={hygiene.without_phone.count}
                  label="Cadastro sem revisão desde"
                  testId="hoje-hygiene-nophone"
                  title="Sem telefone cadastrado"
                />
                <HygieneList
                  clients={hygiene.stale_leads.items}
                  count={hygiene.stale_leads.count}
                  label="Sem revisão desde"
                  testId="hoje-hygiene-stale"
                  title="Leads sem revisão recente"
                />
                <HygieneList
                  clients={hygiene.new_contacts.items}
                  count={hygiene.new_contacts.count}
                  label="Criado"
                  testId="hoje-hygiene-new"
                  title="Novos nos últimos 7 dias"
                  useCreatedAt
                />
              </div>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
