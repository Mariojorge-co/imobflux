import { calculateSLA, type SLAInfo, type SlaSettings } from "@/lib/conversations/sla";
import type { WorkTask } from "@/lib/tasks/model";
import type { PrioridadesDashboardResult } from "@/types/prioridades";

export type TodayAssignee = { member_id: string; display_name: string | null };

export type TodayConversation = {
  conversation_id: string;
  contact_id: string | null;
  participant_name: string | null;
  started_at: string;
  sla_direction: string;
  sla_at: string;
  assignees: TodayAssignee[];
  assigned_to_me: boolean;
  has_outgoing: boolean;
};

export type TodayCounters = {
  incoming_today: number;
  outgoing_today: number;
  new_conversations_today: number;
  tasks_completed_today: number;
};

export type TodayOverview = {
  timezone: string | null;
  day_start: string | null;
  conversations: TodayConversation[];
  counters: TodayCounters;
};

export const EMPTY_OVERVIEW: TodayOverview = {
  timezone: null,
  day_start: null,
  conversations: [],
  counters: { incoming_today: 0, outgoing_today: 0, new_conversations_today: 0, tasks_completed_today: 0 },
};

/** Filtro de responsável (só o proprietário escolhe): todos, sem responsável ou um membro. */
export type AttendantFilter = { kind: "all" } | { kind: "unassigned" } | { kind: "member"; memberId: string };

export const FILTER_ALL = "todos";
export const FILTER_UNASSIGNED = "sem-responsavel";

export function parseAttendantFilter(raw: string | string[] | undefined): AttendantFilter {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value || value === FILTER_ALL) return { kind: "all" };
  if (value === FILTER_UNASSIGNED) return { kind: "unassigned" };
  return { kind: "member", memberId: value };
}

export function filterToParam(filter: AttendantFilter): string {
  return filter.kind === "all" ? FILTER_ALL : filter.kind === "unassigned" ? FILTER_UNASSIGNED : filter.memberId;
}

export type TodayConversationItem = { conversation: TodayConversation; sla: SLAInfo };

export type TodayView = {
  /** Cliente esperando a equipe, do mais antigo (maior espera) ao mais recente. */
  waiting: TodayConversationItem[];
  /** Aguardando cliente com follow-up atingido (nível 1, 2 ou 3), do mais atrasado ao menos. */
  followups: TodayConversationItem[];
  /** Conversas que começaram hoje, sem responsável e ainda sem nenhuma resposta da equipe. */
  newUnattended: TodayConversation[];
  /** Tarefas pendentes de hoje e atrasadas, da mais antiga à mais nova. */
  tasks: WorkTask[];
  counters: TodayCounters;
};

export type BuildOptions = {
  role: "owner" | "attendant";
  memberId: string;
  filter: AttendantFilter;
  settings: SlaSettings;
  now?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function conversationMatches(conversation: TodayConversation, options: BuildOptions): boolean {
  // O atendente só vê o que é dele; o proprietário vê a equipe e pode filtrar.
  if (options.role === "attendant") return conversation.assigned_to_me;
  const { filter } = options;
  if (filter.kind === "all") return true;
  if (filter.kind === "unassigned") return conversation.assignees.length === 0;
  return conversation.assignees.some((assignee) => assignee.member_id === filter.memberId);
}

function taskMatches(task: WorkTask, options: BuildOptions): boolean {
  if (options.role === "attendant") return task.responsible_member_id === options.memberId;
  const { filter } = options;
  if (filter.kind === "all") return true;
  if (filter.kind === "unassigned") return task.responsible_member_id === null;
  return task.responsible_member_id === filter.memberId;
}

/** Monta as listas do painel a partir dos dados já filtrados pela RLS. O prazo vem do cálculo único (calculateSLA). */
export function buildTodayView(overview: TodayOverview, tasks: WorkTask[], options: BuildOptions): TodayView {
  const now = options.now ?? Date.now();
  const dayStart = overview.day_start ? new Date(overview.day_start).getTime() : NaN;
  const dayEnd = Number.isNaN(dayStart) ? NaN : dayStart + DAY_MS;

  const waiting: TodayConversationItem[] = [];
  const followups: TodayConversationItem[] = [];
  const newUnattended: TodayConversation[] = [];

  for (const conversation of overview.conversations) {
    const sla = calculateSLA(conversation.sla_direction, conversation.sla_at, options.settings, now);
    if (!sla) continue;

    // "Novas sem atendimento" não pertencem a ninguém ainda: o atendente também as enxerga para poder assumir.
    const isNewUnattended =
      conversation.assignees.length === 0 &&
      !conversation.has_outgoing &&
      !Number.isNaN(dayStart) &&
      new Date(conversation.started_at).getTime() >= dayStart;
    if (isNewUnattended && (options.role === "attendant" || conversationMatches(conversation, options))) {
      newUnattended.push(conversation);
    }

    if (!conversationMatches(conversation, options)) continue;
    if (sla.type === "team_waiting") waiting.push({ conversation, sla });
    else if (sla.followupLevel >= 1) followups.push({ conversation, sla });
  }

  waiting.sort((a, b) => b.sla.minutesWaiting - a.sla.minutesWaiting);
  followups.sort((a, b) => b.sla.followupLevel - a.sla.followupLevel || b.sla.minutesWaiting - a.sla.minutesWaiting);
  newUnattended.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

  const todayTasks = tasks
    .filter((task) => task.status === "pending" && taskMatches(task, options))
    .filter((task) => {
      const due = new Date(task.due_at).getTime();
      return task.is_overdue || due < now || (!Number.isNaN(dayEnd) && due < dayEnd);
    })
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

  return { waiting, followups, newUnattended, tasks: todayTasks, counters: overview.counters };
}

export type DueFollowup = PrioridadesDashboardResult["due_followups"][number];

/**
 * Follow-ups devidos já aparecem na seção própria (com Reagendar/Concluir): tira da lista de tarefas as que são o mesmo
 * registro, para o mesmo item não ser contado nem mostrado duas vezes na tela.
 */
export function withoutDuplicatedFollowups(tasks: WorkTask[], dueFollowups: DueFollowup[]): WorkTask[] {
  const ids = new Set(dueFollowups.map((followup) => followup.id));
  return tasks.filter((task) => !ids.has(task.id));
}

/**
 * "Para agir agora": quantas pessoas/itens distintos pedem ação da equipe (aguardando resposta, follow-ups devidos,
 * tarefas e novas sem atendimento). Um mesmo cliente em mais de uma seção conta UMA vez; "aguardando cliente" e a
 * higiene de cadastro ficam de fora (a bola não está com a equipe).
 */
export function countActionTargets(view: TodayView, dueFollowups: DueFollowup[]): number {
  const keys = new Set<string>();
  const keyOf = (contactId: string | null | undefined, conversationId: string | null | undefined, fallback: string) =>
    contactId ? `k:${contactId}` : conversationId ? `c:${conversationId}` : `t:${fallback}`;
  for (const { conversation } of view.waiting) keys.add(keyOf(conversation.contact_id, conversation.conversation_id, conversation.conversation_id));
  for (const followup of dueFollowups) keys.add(keyOf(followup.contact_id, followup.conversation_id, followup.id));
  for (const task of view.tasks) keys.add(keyOf(task.contact_id, task.conversation_id, task.id));
  for (const conversation of view.newUnattended) keys.add(keyOf(conversation.contact_id, conversation.conversation_id, conversation.conversation_id));
  return keys.size;
}
