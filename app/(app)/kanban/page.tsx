import { PageContainer, PageHeader } from "@/components/ui";
import { KanbanBoard } from "@/components/kanban/kanban-board";
import { requireActiveAccess } from "@/lib/auth/dal";
import {
  getContactsForSelect,
  getKanbanBoardData,
  getWorkspaceMembersForSelect,
} from "@/lib/kanban/data";

export const revalidate = 0;

export default async function KanbanPage() {
  const [access, stages, contacts, members] = await Promise.all([
    requireActiveAccess(),
    getKanbanBoardData(50),
    getContactsForSelect(),
    getWorkspaceMembersForSelect(),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Kanban Comercial" />
      <section aria-label="Quadro do Kanban Comercial">
        <KanbanBoard
          initialStages={stages}
          contacts={contacts}
          members={members}
          userRole={access.role}
        />
      </section>
    </PageContainer>
  );
}
