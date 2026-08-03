import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

export type InputProps = ComponentPropsWithRef<"input">;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={classNames(
        "min-h-11 w-full rounded-control border border-border-strong bg-surface px-control-x py-control-y text-body text-text outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
