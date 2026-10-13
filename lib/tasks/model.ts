export type TaskStatus = "pending" | "completed" | "cancelled";
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskType = "task" | "follow_up";

export type WorkTask = {
  id: string;
  task_type: TaskType;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string;
  reminder_at: string | null;
  is_overdue: boolean;
  responsible_member_id: string | null;
  responsible_name: string | null;
  created_by_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  conversation_id: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type TaskCounts = { pending: number; overdue: number; mine: number; completed: number };

export type TaskStatusFilter = TaskStatus | "all";
export type TaskScopeFilter = "all" | "mine" | "unassigned";
export type TaskFilters = { status: TaskStatusFilter; scope: TaskScopeFilter };

export const STATUS_TABS: Array<{ value: TaskStatusFilter; param: string; label: string }> = [
  { value: "pending", param: "pendentes", label: "Pendentes" },
  { value: "completed", param: "concluidas", label: "Concluídas" },
  { value: "cancelled", param: "canceladas", label: "Canceladas" },
  { value: "all", param: "todas", label: "Todas" },
];

export const SCOPE_OPTIONS: Array<{ value: TaskScopeFilter; param: string; label: string }> = [
  { value: "all", param: "todas", label: "De todos" },
  { value: "mine", param: "minhas", label: "Minhas" },
  { value: "unassigned", param: "sem-responsavel", label: "Sem responsável" },
];

export const PRIORITY_LABELS: Record<TaskPriority, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
export const TYPE_LABELS: Record<TaskType, string> = { task: "Tarefa", follow_up: "Follow-up" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/** Filtros vindos da URL (?status=pendentes&escopo=minhas); qualquer valor desconhecido volta ao padrão. */
export function parseTaskFilters(params: SearchParams): TaskFilters {
  const status = STATUS_TABS.find((tab) => tab.param === first(params.status))?.value ?? "pending";
  const scope = SCOPE_OPTIONS.find((option) => option.param === first(params.escopo))?.value ?? "all";
  return { status, scope };
}

export function taskFiltersQuery(filters: TaskFilters): string {
  const search = new URLSearchParams();
  const status = STATUS_TABS.find((tab) => tab.value === filters.status)!;
  const scope = SCOPE_OPTIONS.find((option) => option.value === filters.scope)!;
  if (status.value !== "pending") search.set("status", status.param);
  if (scope.value !== "all") search.set("escopo", scope.param);
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Tradução dos erros do banco para mensagens claras (sem códigos técnicos). */
export function taskErrorMessage(message: string | null | undefined): string {
  const text = message ?? "";
  if (text.includes("resource_not_available")) return "Você não tem acesso a este item.";
  if (text.includes("invalid_task_filter")) return "Filtro inválido.";
  if (text.includes("invalid_task")) return "Confira os dados: título obrigatório, prioridade válida e lembrete antes do prazo.";
  if (text.includes("assignee_not_active")) return "Este membro não está ativo na equipe.";
  if (text.includes("assignee_cannot_access_task")) {
    return "Este contato ou conversa é restrito ao proprietário, então só o proprietário pode ser responsável.";
  }
  if (text.includes("task_not_pending")) return "Esta tarefa já foi concluída ou cancelada.";
  return "Não foi possível salvar a tarefa. Tente novamente.";
}

/** Valor de <input type="datetime-local"> (horário de Brasília/Maceió, UTC-3) para ISO; inválido vira null. */
export function localDateTimeToIso(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Prazo legível: "hoje 14:30", "amanhã 09:00" ou "12/10 18:00" (UTC-3). */
export function formatDue(iso: string, now: Date = new Date()): string {
  const offset = -3 * 60 * 60 * 1000;
  const shift = (date: Date) => new Date(date.getTime() + offset);
  const due = shift(new Date(iso));
  const today = shift(now);
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const time = `${String(due.getUTCHours()).padStart(2, "0")}:${String(due.getUTCMinutes()).padStart(2, "0")}`;
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(due) === dayKey(today)) return `hoje ${time}`;
  if (dayKey(due) === dayKey(tomorrow)) return `amanhã ${time}`;
  if (dayKey(due) === dayKey(yesterday)) return `ontem ${time}`;
  return `${String(due.getUTCDate()).padStart(2, "0")}/${String(due.getUTCMonth() + 1).padStart(2, "0")} ${time}`;
}
