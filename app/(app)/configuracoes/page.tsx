import { Settings } from "lucide-react";
import {
  EmptyState,
  PageContainer,
  PageHeader,
} from "@/components/ui";

export default function ConfiguracoesPage() {
  return (
    <PageContainer>
      <PageHeader title="Configurações" />
      <section aria-label="Conteúdo de Configurações">
        <EmptyState
          description="Esta página será preenchida em uma próxima etapa."
          icon={Settings}
          title="Nenhum conteúdo disponível"
        />
      </section>
    </PageContainer>
  );
}
