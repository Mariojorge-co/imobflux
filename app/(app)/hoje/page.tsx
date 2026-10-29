import { PageContainer, PageHeader } from "@/components/ui";
import { AttendantFilterBar, HojeView } from "@/components/hoje/hoje-view";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getMemberDirectory } from "@/lib/conversations/data";
import { getSlaSettings } from "@/lib/conversations/sla-settings-data";
import { getTodayOverview } from "@/lib/hoje/data";
import { buildTodayView, parseAttendantFilter, withoutDuplicatedFollowups } from "@/lib/hoje/model";
import { getPrioridadesDashboard } from "@/lib/prioridades/data";
import { getTasksPage } from "@/lib/tasks/data";

export const metadata = { title: "Hoje" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function HojePage({ searchParams }: PageProps) {
  const access = await requireActiveAccess();
  const params = await searchParams;
  const isOwner = access.role === "owner";
  // Só o proprietário enxerga a equipe e filtra por responsável; o atendente vê apenas o que é dele.
  const filter = isOwner ? parseAttendantFilter(params.atendente) : ({ kind: "all" } as const);

  // Tudo em paralelo: a tela única junta o que antes eram duas (Hoje e Prioridades), sem consulta extra em série.
  const [overview, settings, tasksPage, members, dashboard] = await Promise.all([
    getTodayOverview(),
    getSlaSettings(),
    getTasksPage({ status: "pending", scope: "all" }),
    isOwner ? getMemberDirectory() : Promise.resolve([]),
    getPrioridadesDashboard(),
  ]);

  const dueFollowups = dashboard.due_followups;
  const view = buildTodayView(overview, withoutDuplicatedFollowups(tasksPage.tasks, dueFollowups), {
    role: access.role,
    memberId: access.memberId,
    filter,
    settings,
  });

  return (
    <PageContainer>
      <PageHeader
        description={isOwner ? "O que fazer agora na equipe, em ordem de ação." : "O que fazer agora, em ordem de ação."}
        title="Hoje"
      />
      {isOwner ? <AttendantFilterBar filter={filter} members={members} /> : null}
      <HojeView
        dueFollowups={dueFollowups}
        hygiene={dashboard}
        settings={settings}
        showAssignee={isOwner}
        timezone={overview.timezone}
        view={view}
      />
    </PageContainer>
  );
}
