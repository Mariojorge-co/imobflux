import { Card, PageContainer, PageHeader } from "@/components/ui";

export default function ContactsLoading() {
  return (
    <PageContainer aria-busy="true" aria-label="Carregando contatos">
      <PageHeader
        description="Cadastre e acompanhe os contatos do seu workspace."
        title="Contatos"
      />

      <div className="space-y-section">
        {/* Filters bar skeleton */}
        <div className="flex flex-col gap-stack md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-inline sm:flex-row sm:items-center">
            <div className="h-10 w-full sm:w-72 animate-pulse rounded-control bg-neutral-soft" />
            <div className="h-10 w-full sm:w-40 animate-pulse rounded-control bg-neutral-soft" />
            <div className="h-10 w-full sm:w-32 animate-pulse rounded-control bg-neutral-soft" />
          </div>
          <div className="h-10 w-full sm:w-36 animate-pulse rounded-control bg-neutral-soft" />
        </div>

        {/* Table skeleton (desktop) / cards skeleton (mobile) */}
        <Card className="hidden p-0 md:block">
          <div className="border-b border-border bg-neutral-soft/60 px-card py-3">
            <div className="h-4 w-48 animate-pulse rounded bg-border" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="flex items-center justify-between px-card py-3.5" key={index}>
                <div className="flex items-center gap-3">
                  <div className="size-8 animate-pulse rounded-full bg-neutral-soft" />
                  <div className="space-y-1.5">
                    <div className="h-4 w-36 animate-pulse rounded bg-neutral-soft" />
                    <div className="h-3 w-24 animate-pulse rounded bg-neutral-soft/70" />
                  </div>
                </div>
                <div className="h-5 w-20 animate-pulse rounded-pill bg-neutral-soft" />
                <div className="h-8 w-28 animate-pulse rounded-control bg-neutral-soft" />
                <div className="size-8 animate-pulse rounded-control bg-neutral-soft" />
              </div>
            ))}
          </div>
        </Card>

        {/* Mobile cards skeleton */}
        <div className="space-y-inline md:hidden">
          {Array.from({ length: 4 }, (_, index) => (
            <Card className="p-3.5 space-y-3" key={index}>
              <div className="flex items-center gap-3">
                <div className="size-8 animate-pulse rounded-full bg-neutral-soft" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-32 animate-pulse rounded bg-neutral-soft" />
                  <div className="h-3 w-20 animate-pulse rounded bg-neutral-soft/70" />
                </div>
                <div className="size-8 animate-pulse rounded-control bg-neutral-soft" />
              </div>
              <div className="h-5 w-24 animate-pulse rounded-pill bg-neutral-soft" />
              <div className="h-10 w-full animate-pulse rounded-control bg-neutral-soft" />
            </Card>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
