import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui";
import { classNames } from "@/lib/class-names";
import type { PrioritySummaryItem } from "@/types/prioridades";

type SummaryCardProps = Pick<
  PrioritySummaryItem,
  "context" | "title" | "value"
> & {
  className?: string;
  featured?: boolean;
  icon: LucideIcon;
};

export function SummaryCard({
  className,
  context,
  featured = false,
  icon: Icon,
  title,
  value,
}: SummaryCardProps) {
  return (
    <Card
      className={classNames(
        "flex h-full flex-col gap-stack",
        featured && "border-border-strong bg-neutral-soft",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-stack">
        <p className="text-caption font-medium text-text-muted">{title}</p>
        <span
          className={classNames(
            "flex size-9 shrink-0 items-center justify-center rounded-control text-neutral",
            featured ? "bg-surface" : "bg-neutral-soft",
          )}
        >
          <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
        </span>
      </div>
      <div className="mt-auto">
        <p className="text-2xl font-semibold tracking-tight text-text">
          {value}
        </p>
        <p className="mt-inline text-caption text-text-muted">{context}</p>
      </div>
    </Card>
  );
}
