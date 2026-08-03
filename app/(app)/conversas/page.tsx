import { MessageCircle } from "lucide-react";
import {
  EmptyState,
  PageContainer,
  PageHeader,
} from "@/components/ui";

export default function ConversasPage() {
  return (
    <PageContainer>
      <PageHeader title="Conversas" />
      <section aria-label="Conteúdo de Conversas">
        <EmptyState
          description="Esta página será preenchida em uma próxima etapa."
          icon={MessageCircle}
          title="Nenhum conteúdo disponível"
        />
      </section>
    </PageContainer>
  );
}
