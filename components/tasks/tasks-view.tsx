"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ClipboardCheck, Plus, UserRound, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, ModalDialog, PageHeader, Select } from "@/components/ui";
import {
  cancelTaskAction,
  completeTaskAction,
  createTaskAction,
  reassignTaskAction,
} from "@/lib/tasks/actions";
import type { DirectoryMember } from "@/lib/conversations/assignment";
import {
  PRIORITY_LABELS,
  SCOPE_OPTIONS,
  STATUS_TABS,
  TYPE_LABELS,
  formatDue,
  localDateTimeToIso,
  taskFiltersQuery,
  type TaskCounts,
  type TaskFilters,
  type TaskPriority,
  type TaskType,
  type WorkTask,
} from "@/lib/tasks/model";

type Option = { id: string; label: string; contactId?: string };

type TasksViewProps = {
  tasks: WorkTask[];
  counts: TaskCounts;
  filters: TaskFilters;
  members: DirectoryMember[];
  contacts: Option[];
  opportunities: Option[];
};

const priorityTone: Record<TaskPriority, "neutral" | "warning" | "danger"> = {
  low: "neutral", normal: "neutral", high: "warning", urgent: "danger",
};

function tomorrowAtNine(): string {
  const date = new Date(Date.now() - 3 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)}T09:00`;
}

export function TasksView({ tasks, counts, filters, members, contacts, opportunities }: TasksViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [contactId, setContactId] = useState("");

  const visibleOpportunities = useMemo(
    () => opportunities.filter((opportunity) => !contactId || opportunity.contactId === contactId),
    [opportunities, contactId],
  );

  const run = (action: () => Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.success) setError(result.error ?? "Não foi possível concluir.");
      else router.refresh();
    });
  };

  const submitCreate = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const due = localDateTimeToIso(text("due"));
    const reminderRaw = text("reminder");
    const reminder = reminderRaw ? localDateTimeToIso(reminderRaw) : null;
    if (!due || (reminderRaw && !reminder)) {
      setFormError("Informe um prazo válido.");
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const result = await createTaskAction({
        title: text("title"),
        taskType: text("type") as TaskType,
        priority: text("priority") as TaskPriority,
        dueAt: due,
        reminderAt: reminder,
        description: text("description") || null,
        responsibleMemberId: text("responsible") || null,
        contactId: text("contact") || null,
        opportunityId: text("opportunity") || null,
      });
      if (!result.success) {
        setFormError(result.error);
        return;
      }
      setCreateOpen(false);
      setContactId("");
      form.reset();
      router.refresh();
    });
  };

  const tabHref = (status: TaskFilters["status"]) => `/tarefas${taskFiltersQuery({ ...filters, status })}`;
  const scopeHref = (scope: TaskFilters["scope"]) => `/tarefas${taskFiltersQuery({ ...filters, scope })}`;
  const tabCount = (status: TaskFilters["status"]) =>
    status === "pending" ? counts.pending : status === "completed" ? counts.completed : null;

  return (
    <div className="space-y-stack">
      <PageHeader
        actions={
          <Button onClick={() => { setFormError(null); setCreateOpen(true); }} variant="primary">
            <Plus aria-hidden="true" size={17} />
            <span>Nova tarefa</span>
          </Button>
        }
        description="Ações e follow-ups ligados a contatos e oportunidades, com responsável e prazo."
        title="Tarefas"
      />

      <div className="flex flex-wrap items-center gap-inline" role="tablist" aria-label="Situação das tarefas">
        {STATUS_TABS.map((tab) => {
          const selected = tab.value === filters.status;
          const count = tabCount(tab.value);
          return (
            <Link
              aria-selected={selected}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-3 text-caption font-medium ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-text-muted hover:text-text"}`}
              href={tabHref(tab.value)}
              key={tab.value}
              role="tab"
            >
              {tab.label}{count !== null ? ` (${count})` : ""}
              {tab.value === "pending" && counts.overdue > 0 ? (
                <span className={`rounded-pill px-1.5 ${selected ? "bg-white/25" : "bg-danger-soft text-danger"}`} title="Tarefas atrasadas">{counts.overdue} atrasada{counts.overdue > 1 ? "s" : ""}</span>
              ) : null}
            </Link>
          );
        })}
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
        {SCOPE_OPTIONS.map((option) => (
          <Link
            aria-current={option.value === filters.scope ? "true" : undefined}
            className={`inline-flex min-h-11 items-center rounded-pill px-3 text-caption font-medium ${option.value === filters.scope ? "bg-neutral-soft text-text ring-1 ring-border-strong" : "text-text-muted hover:text-text"}`}
            href={scopeHref(option.value)}
            key={option.value}
          >
            {option.label}{option.value === "mine" ? ` (${counts.mine})` : ""}
          </Link>
        ))}
      </div>

      {error ? <p className="rounded-control border border-danger-border bg-danger-soft p-card text-body text-danger" role="alert">{error}</p> : null}

      {tasks.length === 0 ? (
        <EmptyState
          action={filters.status === "pending" && filters.scope === "all" ? (
            <Button onClick={() => { setFormError(null); setCreateOpen(true); }} variant="primary">
              <Plus aria-hidden="true" size={17} /> Criar primeira tarefa
            </Button>
          ) : undefined}
          data-testid="tasks-empty"
          description={filters.status === "pending" && filters.scope === "all"
            ? "Crie tarefas e follow-ups para não perder o próximo contato com cada cliente."
            : "Nenhuma tarefa com esses filtros."}
          icon={ClipboardCheck}
          title={filters.status === "pending" && filters.scope === "all" ? "Nenhuma tarefa pendente" : "Nada por aqui"}
        />
      ) : (
        <ul aria-label="Lista de tarefas" className="space-y-inline" data-testid="tasks-list">
          {tasks.map((task) => (
            <li key={task.id}>
              <Card className="space-y-2" data-testid="task-card">
                <div className="flex flex-wrap items-start justify-between gap-inline">
                  <div className="min-w-0">
                    <p className={`font-medium ${task.status === "pending" ? "text-text" : "text-text-muted line-through"}`}>{task.title}</p>
                    {task.description ? <p className="text-body text-text-muted">{task.description}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">{TYPE_LABELS[task.task_type]}</Badge>
                    <Badge tone={priorityTone[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge>
                    {task.is_overdue ? <Badge tone="danger">Atrasada</Badge> : null}
                    {task.status === "completed" ? <Badge tone="success">Concluída</Badge> : null}
                    {task.status === "cancelled" ? <Badge tone="neutral">Cancelada</Badge> : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-stack gap-y-1 text-caption text-text-muted">
                  <span className="inline-flex items-center gap-1"><CalendarClock aria-hidden="true" size={13} /> {formatDue(task.due_at)}</span>
                  <span className="inline-flex items-center gap-1"><UserRound aria-hidden="true" size={13} /> {task.responsible_name ?? "Sem responsável"}</span>
                  {task.contact_name ? <span>Contato: {task.contact_name}</span> : null}
                  {task.opportunity_id ? (
                    <Link className="text-primary hover:underline" href={`/kanban?opportunityId=${task.opportunity_id}`}>Oportunidade: {task.opportunity_title ?? "ver"}</Link>
                  ) : null}
                  {task.conversation_id ? (
                    <Link className="text-primary hover:underline" href={`/conversas/${task.conversation_id}`}>Abrir conversa</Link>
                  ) : null}
                </div>

                {task.status === "pending" ? (
                  <div className="flex flex-wrap items-center gap-inline pt-1">
                    <Button disabled={isPending} onClick={() => run(() => completeTaskAction(task.id))} variant="secondary">
                      <Check aria-hidden="true" size={16} /> Concluir
                    </Button>
                    <Select
                      aria-label={`Responsável pela tarefa ${task.title}`}
                      className="w-auto min-w-44"
                      disabled={isPending}
                      onChange={(event) => run(() => reassignTaskAction(task.id, event.target.value || null))}
                      value={task.responsible_member_id ?? ""}
                    >
                      <option value="">Sem responsável</option>
                      {members.map((member) => (
                        <option key={member.member_id} value={member.member_id}>{member.display_name}</option>
                      ))}
                    </Select>
                    <Button
                      disabled={isPending}
                      onClick={() => { if (window.confirm(`Cancelar a tarefa "${task.title}"?`)) run(() => cancelTaskAction(task.id)); }}
                      variant="ghost"
                    >
                      <X aria-hidden="true" size={16} /> Cancelar
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ModalDialog labelledBy="new-task-title" onOpenChange={(open) => { setCreateOpen(open); if (!open) setFormError(null); }} open={createOpen}>
        <form
          className="space-y-3"
          onSubmit={(event) => { event.preventDefault(); submitCreate(event.currentTarget); }}
        >
          <h2 className="font-semibold" id="new-task-title">Nova tarefa</h2>

          <label className="block space-y-1 text-caption font-medium text-text-muted">
            Título
            <Input maxLength={200} name="title" placeholder="Ex.: Ligar para confirmar a visita" required />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-caption font-medium text-text-muted">
              Tipo
              <Select defaultValue="task" name="type">
                <option value="task">Tarefa</option>
                <option value="follow_up">Follow-up</option>
              </Select>
            </label>
            <label className="block space-y-1 text-caption font-medium text-text-muted">
              Prioridade
              <Select defaultValue="normal" name="priority">
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((priority) => (
                  <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>
                ))}
              </Select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-caption font-medium text-text-muted">
              Prazo
              <Input defaultValue={tomorrowAtNine()} name="due" required type="datetime-local" />
            </label>
            <label className="block space-y-1 text-caption font-medium text-text-muted">
              Lembrete (opcional)
              <Input name="reminder" type="datetime-local" />
            </label>
          </div>

          <label className="block space-y-1 text-caption font-medium text-text-muted">
            Contato
            <Select name="contact" onChange={(event) => setContactId(event.target.value)} required value={contactId}>
              <option value="">Escolha o contato…</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.label}</option>)}
            </Select>
          </label>

          <label className="block space-y-1 text-caption font-medium text-text-muted">
            Oportunidade (opcional)
            <Select defaultValue="" name="opportunity">
              <option value="">Nenhuma</option>
              {visibleOpportunities.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.label}</option>)}
            </Select>
          </label>

          <label className="block space-y-1 text-caption font-medium text-text-muted">
            Responsável (opcional)
            <Select defaultValue="" name="responsible">
              <option value="">Sem responsável</option>
              {members.map((member) => <option key={member.member_id} value={member.member_id}>{member.display_name}</option>)}
            </Select>
          </label>

          <label className="block space-y-1 text-caption font-medium text-text-muted">
            Observações (opcional)
            <textarea className="min-h-20 w-full rounded-control border border-border-strong bg-surface px-control-x py-control-y text-body text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" maxLength={2000} name="description" />
          </label>

          {formError ? <p className="text-caption text-danger" role="alert">{formError}</p> : null}

          <div className="flex justify-end gap-inline">
            <Button onClick={() => setCreateOpen(false)} type="button" variant="ghost">Cancelar</Button>
            <Button disabled={isPending} type="submit" variant="primary">{isPending ? "Salvando…" : "Criar tarefa"}</Button>
          </div>
        </form>
      </ModalDialog>
    </div>
  );
}
