import type { ComponentPropsWithRef, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { classNames } from "@/lib/class-names";

export type EmptyStateProps = ComponentPropsWithRef<"div"> & {
  action?: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
};

export function EmptyState({
  action,
  className,
  description,
  icon: Icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={classNames(
        "flex flex-col items-center rounded-card border border-dashed border-border bg-surface p-section text-center",
        className,
      )}
      {...props}
    >
      <div className="flex size-10 items-center justify-center rounded-control bg-neutral-soft text-neutral">
        <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
      </div>
      <h2 className="mt-stack text-section-title font-semibold text-text">
        {title}
      </h2>
      <p className="mt-inline max-w-md text-body text-text-muted">
        {description}
      </p>
      {action ? <div className="mt-stack">{action}</div> : null}
    </div>
  );
}
