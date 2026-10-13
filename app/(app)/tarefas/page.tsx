import { PageContainer } from "@/components/ui";
import { TasksView } from "@/components/tasks/tasks-view";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getMemberDirectory } from "@/lib/conversations/data";
import { getContactsForSelect } from "@/lib/kanban/data";
import { getOpenOpportunitiesForSelect, getTasksPage } from "@/lib/tasks/data";
import { parseTaskFilters } from "@/lib/tasks/model";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TarefasPage({ searchParams }: PageProps) {
  await requireActiveAccess();
  const filters = parseTaskFilters(await searchParams);
  const [page, members, contacts, opportunities] = await Promise.all([
    getTasksPage(filters),
    getMemberDirectory(),
    getContactsForSelect(),
    getOpenOpportunitiesForSelect(),
  ]);

  return (
    <PageContainer>
      <TasksView
        contacts={contacts.map((contact) => ({ id: contact.id, label: contact.displayName }))}
        counts={page.counts}
        filters={filters}
        members={members}
        opportunities={opportunities.map((opportunity) => ({ id: opportunity.id, label: opportunity.title, contactId: opportunity.contactId }))}
        tasks={page.tasks}
      />
    </PageContainer>
  );
}
