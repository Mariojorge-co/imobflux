import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { TaskCounts, TaskFilters, WorkTask } from "@/lib/tasks/model";

export type TasksPage = { tasks: WorkTask[]; counts: TaskCounts };

const EMPTY_COUNTS: TaskCounts = { pending: 0, overdue: 0, mine: 0, completed: 0 };

/** Tarefas visíveis ao usuário (a RLS herda a privacidade do contexto de cada tarefa). */
export async function getTasksPage(filters: TaskFilters): Promise<TasksPage> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_work_tasks", {
    p_status: filters.status,
    p_scope: filters.scope,
    p_limit: 200,
  });
  if (error) throw new Error("Não foi possível carregar as tarefas.");
  const result = data as unknown as { tasks?: WorkTask[]; counts?: TaskCounts } | null;
  return { tasks: result?.tasks ?? [], counts: result?.counts ?? EMPTY_COUNTS };
}

export type OpportunityOption = { id: string; title: string; contactId: string };

/** Oportunidades abertas para ligar uma tarefa (a RLS esconde as de contatos protegidos de quem não pode ver). */
export async function getOpenOpportunitiesForSelect(): Promise<OpportunityOption[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("opportunities")
    .select("id, title, contact_id")
    .eq("status", "open")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error || !data) return [];
  return data.map((row) => ({ id: row.id, title: row.title, contactId: row.contact_id }));
}
