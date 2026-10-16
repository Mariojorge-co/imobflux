import Link from "next/link";
import { AlertCircle, CalendarCheck, Hourglass, ListChecks, MessageCircleWarning, UserPlus } from "lucide-react";
import { Avatar, Card, EmptyState, SectionTitle } from "@/components/ui";
import { classNames } from "@/lib/class-names";
import { SLA_TONE_CLASS, describeSla } from "@/lib/conversations/sla-display";
import type { SLAInfo } from "@/lib/conversations/sla";
import {
  FILTER_ALL,
  FILTER_UNASSIGNED,
  filterToParam,
  type AttendantFilter,
  type TodayConversation,
  type TodayConversationItem,
  type TodayView,
} from "@/lib/hoje/model";
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
  children,
}: {
  title: string;
  count: number;
  testId: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} data-testid={testId}>
      <div className="mb-2 flex items-center gap-2">
        <SectionTitle>{title}</SectionTitle>
        <span className="rounded-pill bg-neutral-soft px-2 py-0.5 text-caption font-medium text-text-muted">{count}</span>
      </div>
      {count === 0 ? (
        <Card className="text-body text-text-muted">{empty}</Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden" padding="none">
          <ul className="divide-y divide-border">{children}</ul>
        </Card>
      )}
    </section>
  );
}

function Counter({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <Card className="min-w-0" data-testid={testId}>
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

export function HojeView({ view, timezone, showAssignee }: { view: TodayView; timezone: string | null; showAssignee: boolean }) {
  const { counters } = view;
  const nothing =
    view.waiting.length === 0 && view.followups.length === 0 && view.newUnattended.length === 0 && view.tasks.length === 0;

  return (
    <div className="space-y-section">
      <div className="grid grid-cols-2 gap-stack lg:grid-cols-4" data-testid="hoje-counters">
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

      <div className="grid gap-section lg:grid-cols-2">
        <Section count={view.waiting.length} empty="Nenhum cliente esperando resposta." testId="hoje-waiting" title="Clientes aguardando resposta">
          {view.waiting.map((item) => (
            <ConversationRow item={item} key={item.conversation.conversation_id} showAssignee={showAssignee} />
          ))}
        </Section>

        <Section count={view.followups.length} empty="Nenhum follow-up para fazer agora." testId="hoje-followups" title="Follow-ups para fazer">
          {view.followups.map((item) => (
            <ConversationRow item={item} key={item.conversation.conversation_id} showAssignee={showAssignee} />
          ))}
        </Section>

        <Section count={view.tasks.length} empty="Nenhuma tarefa para hoje." testId="hoje-tasks" title="Tarefas de hoje e atrasadas">
          {view.tasks.map((task) => (
            <TaskRow key={task.id} task={task} timezone={timezone} />
          ))}
        </Section>

        <Section count={view.newUnattended.length} empty="Nenhuma conversa nova sem atendimento." testId="hoje-new" title="Novas sem atendimento">
          {view.newUnattended.map((conversation) => (
            <li key={conversation.conversation_id}>
              <Link
                aria-label={`Abrir conversa com ${conversation.participant_name || "Contato"}`}
                className="flex min-h-11 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-neutral-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="hoje-new-item"
                href={`/conversas/${conversation.conversation_id}`}
              >
                <UserPlus aria-hidden="true" className="shrink-0 text-text-muted" size={18} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                  {conversation.participant_name || "Contato"}
                </span>
                <span className="text-caption text-text-muted">{formatDue(conversation.started_at, timezone)}</span>
              </Link>
            </li>
          ))}
        </Section>
      </div>
    </div>
  );
}
