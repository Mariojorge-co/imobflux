import { expect, test } from "@playwright/test";
import { DEFAULT_SLA_SETTINGS } from "../lib/conversations/sla";
import {
  buildTodayView,
  countActionTargets,
  withoutDuplicatedFollowups,
  type DueFollowup,
  EMPTY_OVERVIEW,
  filterToParam,
  parseAttendantFilter,
  type TodayConversation,
  type TodayOverview,
} from "../lib/hoje/model";
import type { WorkTask } from "../lib/tasks/model";

const NOW = Date.parse("2026-10-16T15:00:00Z");
const DAY_START = "2026-10-16T03:00:00Z";
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function conversation(id: string, overrides: Partial<TodayConversation> = {}): TodayConversation {
  return {
    conversation_id: id,
    contact_id: null,
    participant_name: `Cliente ${id}`,
    started_at: minutesAgo(600),
    sla_direction: "incoming",
    sla_at: minutesAgo(20),
    assignees: [],
    assigned_to_me: false,
    has_outgoing: true,
    ...overrides,
  };
}

function task(id: string, overrides: Partial<WorkTask> = {}): WorkTask {
  return {
    id,
    task_type: "task",
    title: `Tarefa ${id}`,
    description: null,
    status: "pending",
    priority: "normal",
    due_at: new Date(NOW + 3 * 3_600_000).toISOString(),
    reminder_at: null,
    is_overdue: false,
    responsible_member_id: null,
    responsible_name: null,
    created_by_name: null,
    contact_id: null,
    contact_name: null,
    opportunity_id: null,
    opportunity_title: null,
    conversation_id: null,
    completed_at: null,
    cancelled_at: null,
    created_at: minutesAgo(1000),
    ...overrides,
  };
}

function overview(conversations: TodayConversation[]): TodayOverview {
  return { ...EMPTY_OVERVIEW, day_start: DAY_START, conversations };
}

const base = { memberId: "m-att", settings: DEFAULT_SLA_SETTINGS, now: NOW };
const ownerAll = { ...base, role: "owner" as const, memberId: "m-owner", filter: { kind: "all" } as const };
const attendant = { ...base, role: "attendant" as const, filter: { kind: "all" } as const };

test.describe("Painel Hoje — agrupamento", () => {
  test("separa cliente esperando (equipe deve) de follow-up (cliente deve) com o cálculo único de prazo", () => {
    const view = buildTodayView(
      overview([
        conversation("a", { sla_direction: "incoming", sla_at: minutesAgo(5) }),
        conversation("b", { sla_direction: "incoming", sla_at: minutesAgo(90) }),
        conversation("c", { sla_direction: "outgoing", sla_at: minutesAgo(30) }), // recente: não é follow-up
        conversation("d", { sla_direction: "outgoing", sla_at: minutesAgo(400) }), // nível 1
        conversation("e", { sla_direction: "outgoing", sla_at: minutesAgo(5000) }), // nível 3
      ]),
      [],
      ownerAll,
    );
    expect(view.waiting.map((item) => item.conversation.conversation_id)).toEqual(["b", "a"]);
    expect(view.followups.map((item) => item.conversation.conversation_id)).toEqual(["e", "d"]);
    expect(view.followups[0].sla.followupLevel).toBe(3);
  });

  test("conversa sem mensagem válida não aparece", () => {
    const view = buildTodayView(overview([conversation("x", { sla_direction: "", sla_at: "" })]), [], ownerAll);
    expect(view.waiting).toHaveLength(0);
    expect(view.followups).toHaveLength(0);
  });

  test("novas sem atendimento: começou hoje, sem responsável e sem resposta da equipe", () => {
    const view = buildTodayView(
      overview([
        conversation("n1", { started_at: minutesAgo(60), has_outgoing: false }),
        conversation("n2", { started_at: minutesAgo(60), has_outgoing: true }), // já respondida
        conversation("n3", { started_at: minutesAgo(60), has_outgoing: false, assignees: [{ member_id: "m-att", display_name: "Ana" }] }),
        conversation("n4", { started_at: "2026-10-10T12:00:00Z", has_outgoing: false }), // começou antes de hoje
      ]),
      [],
      ownerAll,
    );
    expect(view.newUnattended.map((item) => item.conversation_id)).toEqual(["n1"]);
  });
});

test.describe("Painel Hoje — visibilidade por papel", () => {
  const items = overview([
    conversation("mine", { assigned_to_me: true, assignees: [{ member_id: "m-att", display_name: "Ana" }] }),
    conversation("other", { assignees: [{ member_id: "m-other", display_name: "Beto" }] }),
    conversation("free", { assignees: [], has_outgoing: false, started_at: minutesAgo(30) }),
  ]);

  test("o atendente vê só as conversas dele (e as novas sem dono, para poder assumir)", () => {
    const view = buildTodayView(items, [], attendant);
    expect(view.waiting.map((item) => item.conversation.conversation_id)).toEqual(["mine"]);
    expect(view.newUnattended.map((item) => item.conversation_id)).toEqual(["free"]);
  });

  test("o atendente ignora o filtro da URL: nunca vê a equipe", () => {
    const view = buildTodayView(items, [], { ...attendant, filter: { kind: "member", memberId: "m-other" } });
    expect(view.waiting.map((item) => item.conversation.conversation_id)).toEqual(["mine"]);
  });

  test("o proprietário vê a equipe toda e filtra por responsável ou por sem responsável", () => {
    expect(buildTodayView(items, [], ownerAll).waiting).toHaveLength(3);
    const byMember = buildTodayView(items, [], { ...ownerAll, filter: { kind: "member", memberId: "m-other" } });
    expect(byMember.waiting.map((item) => item.conversation.conversation_id)).toEqual(["other"]);
    const free = buildTodayView(items, [], { ...ownerAll, filter: { kind: "unassigned" } });
    expect(free.waiting.map((item) => item.conversation.conversation_id)).toEqual(["free"]);
  });
});

test.describe("Painel Hoje — tarefas", () => {
  const tasks = [
    task("late", { is_overdue: true, due_at: minutesAgo(3000), responsible_member_id: "m-att" }),
    task("today", { responsible_member_id: "m-att" }),
    task("tomorrow", { due_at: new Date(NOW + 30 * 3_600_000).toISOString(), responsible_member_id: "m-att" }),
    task("other", { responsible_member_id: "m-other" }),
    task("done", { status: "completed", responsible_member_id: "m-att" }),
  ];

  test("traz atrasadas e de hoje, da mais antiga à mais nova; ignora amanhã e concluídas", () => {
    const view = buildTodayView(overview([]), tasks, ownerAll);
    expect(view.tasks.map((item) => item.id)).toEqual(["late", "today", "other"]);
  });

  test("o atendente só vê as tarefas dele; o proprietário filtra pelo responsável", () => {
    expect(buildTodayView(overview([]), tasks, attendant).tasks.map((item) => item.id)).toEqual(["late", "today"]);
    const view = buildTodayView(overview([]), tasks, { ...ownerAll, filter: { kind: "member", memberId: "m-other" } });
    expect(view.tasks.map((item) => item.id)).toEqual(["other"]);
  });
});

test.describe("Painel Hoje — filtro da URL", () => {
  test("lê, valida e devolve o parâmetro", () => {
    expect(parseAttendantFilter(undefined)).toEqual({ kind: "all" });
    expect(parseAttendantFilter("todos")).toEqual({ kind: "all" });
    expect(parseAttendantFilter("sem-responsavel")).toEqual({ kind: "unassigned" });
    expect(parseAttendantFilter(["abc", "x"])).toEqual({ kind: "member", memberId: "abc" });
    expect(filterToParam({ kind: "member", memberId: "abc" })).toBe("abc");
    expect(filterToParam({ kind: "unassigned" })).toBe("sem-responsavel");
  });
});

test.describe("Hoje unificado — contagem sem duplicar", () => {
  const settings = DEFAULT_SLA_SETTINGS;
  const owner = { role: "owner" as const, memberId: "m-owner", filter: { kind: "all" as const }, settings, now: NOW };
  const due = (id: string, contactId: string, conversationId: string | null): DueFollowup => ({
    id,
    title: "Ligar",
    due_at: minutesAgo(30),
    contact_id: contactId,
    conversation_id: conversationId,
    opportunity_id: null,
    display_name: "Cliente",
  });

  test("o mesmo cliente em várias seções conta uma vez só em Para agir agora", () => {
    const waiting = conversation("c1", { contact_id: "k1", sla_direction: "incoming", sla_at: minutesAgo(30), started_at: minutesAgo(30) });
    const other = conversation("c2", { contact_id: "k2", sla_direction: "incoming", sla_at: minutesAgo(40), has_outgoing: true });
    const view = buildTodayView(overview([waiting, other]), [task("t1", { contact_id: "k1", conversation_id: "c1" }), task("t2", { contact_id: null })], owner);
    // k1: aguardando + nova sem atendimento + tarefa + follow-up devido; k2: aguardando; t2: tarefa solta
    expect(view.waiting).toHaveLength(2);
    expect(countActionTargets(view, [due("f1", "k1", "c1")])).toBe(3);
  });

  test("aguardando cliente (follow-up de conversa) não entra em Para agir agora", () => {
    const view = buildTodayView(overview([conversation("c3", { contact_id: "k3", sla_direction: "outgoing", sla_at: minutesAgo(60 * 30) })]), [], owner);
    expect(view.followups).toHaveLength(1);
    expect(countActionTargets(view, [])).toBe(0);
  });

  test("um follow-up devido não aparece de novo na lista de tarefas", () => {
    const tasks = [task("f1", { task_type: "follow_up" }), task("t1")];
    expect(withoutDuplicatedFollowups(tasks, [due("f1", "k1", null)]).map((item) => item.id)).toEqual(["t1"]);
  });
});
