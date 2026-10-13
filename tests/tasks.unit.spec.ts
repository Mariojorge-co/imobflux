import "./helpers/server-only";

import { expect, test } from "@playwright/test";
import {
  formatDue,
  localDateTimeToIso,
  parseTaskFilters,
  taskErrorMessage,
  taskFiltersQuery,
} from "../lib/tasks/model";

/* eslint-disable @typescript-eslint/no-require-imports */
const nextCachePath = require.resolve("next/cache");
require.cache[nextCachePath] = {
  id: nextCachePath, filename: nextCachePath, loaded: true, exports: { revalidatePath: () => undefined },
} as never;
const serverModule = require("@/lib/supabase/server");
const actions = require("@/lib/tasks/actions") as typeof import("@/lib/tasks/actions");
const conversationActions = require("@/lib/conversations/actions") as typeof import("@/lib/conversations/actions");
/* eslint-enable @typescript-eslint/no-require-imports */

const TASK = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

test.describe("Tarefas: filtros e formatação", () => {
  test("filtros da URL: padrão pendentes/todas; valores inválidos voltam ao padrão", () => {
    expect(parseTaskFilters({})).toEqual({ status: "pending", scope: "all" });
    expect(parseTaskFilters({ status: "concluidas", escopo: "minhas" })).toEqual({ status: "completed", scope: "mine" });
    expect(parseTaskFilters({ status: "todas", escopo: "sem-responsavel" })).toEqual({ status: "all", scope: "unassigned" });
    expect(parseTaskFilters({ status: "'; drop", escopo: ["x"] })).toEqual({ status: "pending", scope: "all" });
  });

  test("querystring só leva o que difere do padrão", () => {
    expect(taskFiltersQuery({ status: "pending", scope: "all" })).toBe("");
    expect(taskFiltersQuery({ status: "completed", scope: "all" })).toBe("?status=concluidas");
    expect(taskFiltersQuery({ status: "pending", scope: "mine" })).toBe("?escopo=minhas");
    expect(taskFiltersQuery({ status: "all", scope: "unassigned" })).toBe("?status=todas&escopo=sem-responsavel");
  });

  test("datetime-local vira ISO em UTC-3; inválido vira nulo", () => {
    expect(localDateTimeToIso("2026-10-13T09:00")).toBe("2026-10-13T12:00:00.000Z");
    expect(localDateTimeToIso("")).toBeNull();
    expect(localDateTimeToIso("13/10/2026 09:00")).toBeNull();
    expect(localDateTimeToIso("2026-13-45T25:61")).toBeNull();
    expect(localDateTimeToIso(null)).toBeNull();
  });

  test("prazo legível: hoje, amanhã, ontem e data", () => {
    const now = new Date("2026-10-13T15:00:00.000Z"); // 12:00 em Brasília
    expect(formatDue("2026-10-13T20:30:00.000Z", now)).toBe("hoje 17:30");
    expect(formatDue("2026-10-14T12:00:00.000Z", now)).toBe("amanhã 09:00");
    expect(formatDue("2026-10-12T12:00:00.000Z", now)).toBe("ontem 09:00");
    expect(formatDue("2026-10-20T12:00:00.000Z", now)).toBe("20/10 09:00");
    // 01:00 UTC ainda é o dia anterior em Brasília
    expect(formatDue("2026-10-14T01:00:00.000Z", now)).toBe("hoje 22:00");
  });

  test("erros do banco viram mensagens claras", () => {
    for (const code of ["resource_not_available", "invalid_task", "assignee_not_active", "assignee_cannot_access_task", "task_not_pending"]) {
      const message = taskErrorMessage(`erro ${code}`);
      expect(message).not.toContain(code);
      expect(message.length).toBeGreaterThan(10);
    }
    expect(taskErrorMessage("invalid_task_filter")).toBe("Filtro inválido.");
    expect(taskErrorMessage("outra coisa")).toContain("Tente novamente");
  });
});

let calls: Array<{ fn: string; args: Record<string, unknown> }>;
let rpcResult: { data: unknown; error: { message: string } | null };

test.describe("Tarefas: ações", () => {
  test.beforeEach(() => {
    calls = [];
    rpcResult = { data: { success: true, task_id: TASK }, error: null };
    serverModule.createServerSupabaseClient = async () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return rpcResult; },
    });
  });

  const base = { title: "  Ligar  ", taskType: "follow_up" as const, priority: "high" as const, dueAt: "2026-10-14T12:00:00.000Z", contactId: CONTACT };

  test("criar envia os campos normalizados para a função do banco", async () => {
    const result = await actions.createTaskAction({ ...base, responsibleMemberId: MEMBER, description: "  obs  ", reminderAt: null });
    expect(result).toEqual({ success: true, taskId: TASK });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("create_work_task");
    expect(calls[0].args).toMatchObject({
      p_title: "Ligar", p_task_type: "follow_up", p_priority: "high", p_due_at: base.dueAt,
      p_responsible_member_id: MEMBER, p_description: "obs", p_contact_id: CONTACT,
    });
  });

  test("dados inválidos nunca chegam ao banco", async () => {
    const invalid = [
      { ...base, title: "   " },
      { ...base, title: "x".repeat(201) },
      { ...base, taskType: "lembrete" as never },
      { ...base, priority: "maxima" as never },
      { ...base, dueAt: "amanhã" },
      { ...base, contactId: "não-uuid" },
      { ...base, responsibleMemberId: "x" },
      { ...base, contactId: null, opportunityId: null },
    ];
    for (const input of invalid) {
      const result = await actions.createTaskAction(input);
      expect(result.success).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  test("concluir e cancelar chamam as funções certas; id inválido é recusado", async () => {
    expect((await actions.completeTaskAction(TASK)).success).toBe(true);
    expect((await actions.cancelTaskAction(TASK)).success).toBe(true);
    expect(calls.map((call) => call.fn)).toEqual(["complete_work_task", "cancel_work_task"]);
    expect((await actions.completeTaskAction("x")).success).toBe(false);
    expect(calls).toHaveLength(2);
  });

  test("trocar responsável aceita nulo (sem responsável) e recusa id inválido", async () => {
    expect((await actions.reassignTaskAction(TASK, MEMBER)).success).toBe(true);
    expect((await actions.reassignTaskAction(TASK, null)).success).toBe(true);
    expect(calls[0].args).toEqual({ p_task_id: TASK, p_responsible_member_id: MEMBER });
    expect(calls[1].args).toEqual({ p_task_id: TASK, p_responsible_member_id: undefined });
    expect((await actions.reassignTaskAction(TASK, "x")).success).toBe(false);
  });

  test("erro do banco vira mensagem amigável e exceção não vaza", async () => {
    rpcResult = { data: null, error: { message: "task_not_pending" } };
    const result = await actions.completeTaskAction(TASK);
    expect(result).toEqual({ success: false, error: taskErrorMessage("task_not_pending") });
    serverModule.createServerSupabaseClient = async () => { throw new Error("boom"); };
    expect((await actions.cancelTaskAction(TASK)).success).toBe(false);
  });
});

test.describe("Tarefas na conversa: erros amigáveis e conclusão idempotente", () => {
  test.beforeEach(() => {
    calls = [];
    rpcResult = { data: { success: true, status: "already_completed", task_id: TASK }, error: null };
    serverModule.createServerSupabaseClient = async () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return rpcResult; },
    });
  });

  test("concluir tarefa já concluída (o banco responde already_completed) é sucesso", async () => {
    const result = await conversationActions.completeWorkTaskAction(TASK);
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([{ fn: "complete_work_task", args: { p_task_id: TASK } }]);
    const viaTasksPage = await actions.completeTaskAction(TASK);
    expect(viaTasksPage.success).toBe(true);
  });

  test("concluir tarefa cancelada: mensagem em português, sem task_not_pending", async () => {
    rpcResult = { data: null, error: { message: "task_not_pending" } };
    const result = await conversationActions.completeWorkTaskAction(TASK);
    expect(result.success).toBe(false);
    expect(result.error).toBe(taskErrorMessage("task_not_pending"));
    expect(result.error).not.toContain("task_not_pending");
  });

  test("editar tarefa que não está pendente: mensagem em português", async () => {
    rpcResult = { data: null, error: { message: "task_not_pending" } };
    const result = await conversationActions.upsertWorkTaskAction({ taskType: "task", title: "x", taskId: TASK });
    expect(result.success).toBe(false);
    expect(result.error).toContain("já foi concluída ou cancelada");
    expect(result.error).not.toContain("task_not_pending");
  });
});
