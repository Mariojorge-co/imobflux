import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui";
import { classNames } from "@/lib/class-names";
import type { PrioritySummaryItem } from "@/types/prioridades";

type SummaryCardProps = Pick<
  PrioritySummaryItem,
  "context" | "title" | "value"
> & {
  className?: string;
  icon: LucideIcon;
};

export function SummaryCard({
  className,
  context,
  icon: Icon,
  title,
  value,
}: SummaryCardProps) {
  return (
    <Card
      className={classNames(
        "flex h-full flex-row items-center justify-between gap-stack p-3 sm:flex-col sm:items-stretch",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-inline">
        <p className="text-caption font-medium text-text-muted">{title}</p>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-neutral-soft/60 text-text-muted">
          <Icon aria-hidden="true" size={15} strokeWidth={1.5} />
        </span>
      </div>
      <div className="shrink-0 text-right sm:mt-auto sm:text-left">
        <p className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
          {value}
        </p>
        <p className="mt-0.5 hidden text-caption text-text-muted sm:block">{context}</p>
      </div>
    </Card>
  );
}
