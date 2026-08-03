import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

export type SelectProps = ComponentPropsWithRef<"select">;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={classNames(
        "min-h-11 w-full rounded-control border border-border-strong bg-surface px-control-x py-control-y text-body text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
