import { Card, PageContainer, PageHeader } from "@/components/ui";

export default function ContactsLoading() {
  return (
    <PageContainer aria-busy="true" aria-label="Carregando contatos">
      <PageHeader description="Carregando sua carteira de contatos." title="Contatos" />
      <Card className="space-y-stack">
        <div className="h-11 w-full animate-pulse rounded-control bg-neutral-soft" />
        <div className="h-40 animate-pulse rounded-control bg-neutral-soft" />
      </Card>
    </PageContainer>
  );
}
