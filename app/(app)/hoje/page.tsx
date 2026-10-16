import { PageContainer, PageHeader } from "@/components/ui";
import { AttendantFilterBar, HojeView } from "@/components/hoje/hoje-view";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getMemberDirectory } from "@/lib/conversations/data";
import { getSlaSettings } from "@/lib/conversations/sla-settings-data";
import { getTodayOverview } from "@/lib/hoje/data";
import { buildTodayView, parseAttendantFilter } from "@/lib/hoje/model";
import { getTasksPage } from "@/lib/tasks/data";

export const metadata = { title: "Hoje" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function HojePage({ searchParams }: PageProps) {
  const access = await requireActiveAccess();
  const params = await searchParams;
  const isOwner = access.role === "owner";
  // Só o proprietário enxerga a equipe e filtra por responsável; o atendente vê apenas o que é dele.
  const filter = isOwner ? parseAttendantFilter(params.atendente) : ({ kind: "all" } as const);

  const [overview, settings, tasksPage, members] = await Promise.all([
    getTodayOverview(),
    getSlaSettings(),
    getTasksPage({ status: "pending", scope: "all" }),
    isOwner ? getMemberDirectory() : Promise.resolve([]),
  ]);

  const view = buildTodayView(overview, tasksPage.tasks, {
    role: access.role,
    memberId: access.memberId,
    filter,
    settings,
  });

  return (
    <PageContainer>
      <PageHeader
        description={isOwner ? "O que precisa de atenção na equipe hoje." : "O que precisa da sua atenção hoje."}
        title="Hoje"
      />
      {isOwner ? <AttendantFilterBar filter={filter} members={members} /> : null}
      <HojeView showAssignee={isOwner} timezone={overview.timezone} view={view} />
    </PageContainer>
  );
}
