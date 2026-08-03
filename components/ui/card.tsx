import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

const cardPaddings = {
  default: "p-card",
  none: "p-0",
} as const;

export type CardPadding = keyof typeof cardPaddings;

export type CardProps = ComponentPropsWithRef<"div"> & {
  padding?: CardPadding;
};

export function Card({
  className,
  padding = "default",
  ...props
}: CardProps) {
  return (
    <div
      className={classNames(
        "rounded-card border border-border bg-surface text-text",
        cardPaddings[padding],
        className,
      )}
      {...props}
    />
  );
}
