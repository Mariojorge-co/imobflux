"use server";

import { revalidatePath } from "next/cache";
import * as serverModule from "@/lib/supabase/server";
import { taskErrorMessage } from "@/lib/tasks/model";
import type { TaskPriority, TaskType } from "@/lib/tasks/model";

export type TaskActionResult = { success: true; taskId?: string } | { success: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES: TaskType[] = ["task", "follow_up"];
const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

export type CreateTaskInput = {
  title: string;
  taskType: TaskType;
  priority: TaskPriority;
  /** ISO 8601 ou nulo (o banco usa "amanhã" como prazo padrão). */
  dueAt: string | null;
  reminderAt?: string | null;
  description?: string | null;
  responsibleMemberId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
};

function validIso(value: string | null | undefined): boolean {
  return value == null || (typeof value === "string" && !Number.isNaN(new Date(value).getTime()));
}

function revalidateTaskPages(): void {
  revalidatePath("/tarefas");
  revalidatePath("/hoje");
}

export async function createTaskAction(input: CreateTaskInput): Promise<TaskActionResult> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const ids = [input.responsibleMemberId, input.contactId, input.opportunityId].filter((id): id is string => Boolean(id));
  if (
    !title || title.length > 200 ||
    !TYPES.includes(input.taskType) || !PRIORITIES.includes(input.priority) ||
    !validIso(input.dueAt) || !validIso(input.reminderAt) ||
    !ids.every((id) => UUID.test(id)) ||
    !(input.contactId || input.opportunityId)
  ) {
    return { success: false, error: taskErrorMessage("invalid_task") };
  }

  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data, error } = await supabase.rpc("create_work_task", {
      p_title: title,
      p_task_type: input.taskType,
      p_due_at: input.dueAt ?? undefined,
      p_priority: input.priority,
      p_responsible_member_id: input.responsibleMemberId || undefined,
      p_description: input.description?.trim() || undefined,
      p_reminder_at: input.reminderAt ?? undefined,
      p_contact_id: input.contactId || undefined,
      p_opportunity_id: input.opportunityId || undefined,
    });
    if (error) return { success: false, error: taskErrorMessage(error.message) };
    revalidateTaskPages();
    return { success: true, taskId: (data as { task_id?: string } | null)?.task_id };
  } catch (error) {
    console.error("Erro ao criar tarefa:", error);
    return { success: false, error: taskErrorMessage(null) };
  }
}

async function simpleAction(
  taskId: string,
  call: (supabase: Awaited<ReturnType<typeof serverModule.createServerSupabaseClient>>) => PromiseLike<{ error: { message?: string } | null }>,
): Promise<TaskActionResult> {
  if (typeof taskId !== "string" || !UUID.test(taskId)) return { success: false, error: taskErrorMessage("invalid_task") };
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await call(supabase);
    if (error) return { success: false, error: taskErrorMessage(error.message) };
    revalidateTaskPages();
    return { success: true, taskId };
  } catch (error) {
    console.error("Erro ao alterar tarefa:", error);
    return { success: false, error: taskErrorMessage(null) };
  }
}

export async function completeTaskAction(taskId: string): Promise<TaskActionResult> {
  return simpleAction(taskId, (supabase) => supabase.rpc("complete_work_task", { p_task_id: taskId }));
}

export async function cancelTaskAction(taskId: string): Promise<TaskActionResult> {
  return simpleAction(taskId, (supabase) => supabase.rpc("cancel_work_task", { p_task_id: taskId }));
}

/** memberId nulo deixa a tarefa sem responsável. */
export async function reassignTaskAction(taskId: string, memberId: string | null): Promise<TaskActionResult> {
  if (memberId !== null && !UUID.test(memberId)) return { success: false, error: taskErrorMessage("invalid_task") };
  return simpleAction(taskId, (supabase) =>
    supabase.rpc("reassign_work_task", { p_task_id: taskId, p_responsible_member_id: memberId ?? undefined }));
}
