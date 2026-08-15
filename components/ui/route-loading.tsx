import { Card } from "./card";
import { PageContainer } from "./page-container";
import { PageHeader } from "./page-header";

type RouteLoadingProps = {
  title: string;
  variant?: "page" | "conversations";
};

export function RouteLoading({ title, variant = "page" }: RouteLoadingProps) {
  if (variant === "conversations") {
    return (
      <div aria-busy="true" aria-label={`Carregando ${title.toLowerCase()}`} className="flex h-[calc(100dvh-64px)] w-full overflow-hidden bg-background">
        <div className="w-full shrink-0 border-r border-border bg-surface p-stack md:w-[19rem] xl:w-80">
          <div className="h-7 w-28 animate-pulse rounded-control bg-neutral-soft" />
          <div className="mt-stack h-11 animate-pulse rounded-control bg-neutral-soft" />
          <div className="mt-stack space-y-inline">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="h-[4.5rem] animate-pulse rounded-control bg-neutral-soft" key={index} />
            ))}
          </div>
        </div>
        <div className="hidden flex-1 items-center justify-center md:flex">
          <div className="h-24 w-56 animate-pulse rounded-card bg-neutral-soft" />
        </div>
      </div>
    );
  }

  return (
    <PageContainer aria-busy="true" aria-label={`Carregando ${title.toLowerCase()}`}>
      <PageHeader description="Carregando informações atualizadas." title={title} />
      <div className="grid gap-stack md:grid-cols-2">
        {Array.from({ length: 2 }, (_, column) => (
          <Card className="space-y-inline" key={column}>
            {Array.from({ length: 4 }, (_, row) => (
              <div className="h-16 animate-pulse rounded-control bg-neutral-soft" key={row} />
            ))}
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
