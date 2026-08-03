import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

export type SectionTitleProps = ComponentPropsWithRef<"h2">;

export function SectionTitle({
  className,
  ...props
}: SectionTitleProps) {
  return (
    <h2
      className={classNames(
        "text-section-title font-semibold text-text",
        className,
      )}
      {...props}
    />
  );
}
