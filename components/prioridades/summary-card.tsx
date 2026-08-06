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
        "flex h-full flex-col justify-between gap-stack",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-inline">
        <p className="text-caption font-medium text-text-muted">{title}</p>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-neutral-soft/60 text-text-muted">
          <Icon aria-hidden="true" size={15} strokeWidth={1.5} />
        </span>
      </div>
      <div className="mt-auto">
        <p className="text-2xl font-semibold tracking-tight text-text">
          {value}
        </p>
        <p className="mt-0.5 text-caption text-text-muted">{context}</p>
      </div>
    </Card>
  );
}
