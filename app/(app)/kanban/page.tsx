import { Columns3 } from "lucide-react";
import {
  EmptyState,
  PageContainer,
  PageHeader,
} from "@/components/ui";

export default function KanbanPage() {
  return (
    <PageContainer>
      <PageHeader title="Kanban" />
      <section aria-label="Conteúdo de Kanban">
        <EmptyState
          description="Esta página será preenchida em uma próxima etapa."
          icon={Columns3}
          title="Nenhum conteúdo disponível"
        />
      </section>
    </PageContainer>
  );
}
