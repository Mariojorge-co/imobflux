import type { ComponentPropsWithRef } from "react";
import { Search } from "lucide-react";
import { classNames } from "@/lib/class-names";

export type SearchInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type"
> & {
  label?: string;
};

export function SearchInput({
  "aria-label": ariaLabel,
  className,
  label = "Buscar",
  ...props
}: SearchInputProps) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
        size={18}
        strokeWidth={1.8}
      />
      <input
        aria-label={ariaLabel ?? label}
        className={classNames(
          "w-full rounded-control border border-border bg-surface py-control-y pl-10 pr-control-x text-body text-text outline-none placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-neutral-soft disabled:opacity-60",
          className,
        )}
        type="search"
        {...props}
      />
    </div>
  );
}
