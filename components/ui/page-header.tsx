import type { ComponentPropsWithRef, ReactNode } from "react";
import { classNames } from "@/lib/class-names";

export type PageHeaderProps = ComponentPropsWithRef<"header"> & {
  actions?: ReactNode;
  description?: string;
  title: string;
};

export function PageHeader({
  actions,
  className,
  description,
  title,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={classNames(
        "flex flex-wrap items-start justify-between gap-stack",
        className,
      )}
      {...props}
    >
      <div>
        <h1 className="text-page-title font-semibold tracking-tight text-text">
          {title}
        </h1>
        {description ? (
          <p className="mt-inline text-body text-text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-inline">{actions}</div> : null}
    </header>
  );
}
