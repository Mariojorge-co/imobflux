import { Card, PageContainer, PageHeader } from "@/components/ui";

export default function KanbanLoading() {
  return (
    <PageContainer aria-busy="true" aria-label="Carregando Kanban Comercial">
      <PageHeader
        description="Acompanhe e movimente suas oportunidades pelo funil de vendas."
        title="Kanban Comercial"
      />

      <div className="flex flex-col gap-4">
        {/* Barra superior de ações */}
        <Card className="flex items-center justify-between gap-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-5 w-36 animate-pulse rounded bg-neutral-soft" />
            <div className="h-4 w-28 animate-pulse rounded bg-neutral-soft/60" />
          </div>
          <div className="h-9 w-36 animate-pulse rounded-control bg-neutral-soft" />
        </Card>

        {/* Quadro Kanban Skeleton */}
        <div className="flex gap-4 overflow-x-hidden pb-4 pt-1 items-start min-h-[calc(100vh-220px)]">
          {Array.from({ length: 4 }, (_, colIndex) => (
            <div
              className="flex w-72 sm:w-80 shrink-0 flex-col rounded-card border border-border bg-neutral-soft/40 p-card space-y-3"
              key={colIndex}
            >
              {/* Header da coluna */}
              <div className="flex items-center justify-between pb-2.5 border-b border-border">
                <div className="h-5 w-24 animate-pulse rounded bg-neutral-soft" />
                <div className="size-5 animate-pulse rounded-full bg-neutral-soft" />
              </div>

              {/* Cards da coluna */}
              <div className="space-y-2.5">
                {Array.from({ length: 3 }, (_, cardIndex) => (
                  <Card className="p-3.5 space-y-2.5" key={cardIndex}>
                    <div className="h-4 w-3/4 animate-pulse rounded bg-neutral-soft" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-soft/70" />
                    <div className="pt-2 border-t border-border flex items-center justify-between">
                      <div className="h-3 w-20 animate-pulse rounded bg-neutral-soft/60" />
                      <div className="h-3 w-14 animate-pulse rounded bg-neutral-soft/60" />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
