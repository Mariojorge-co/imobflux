import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

const badgeTones = {
  neutral: "border-neutral-border bg-neutral-soft text-neutral",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
  danger: "border-danger-border bg-danger-soft text-danger",
  info: "border-info-border bg-info-soft text-info",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export type BadgeProps = ComponentPropsWithRef<"span"> & {
  tone?: BadgeTone;
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: BadgeProps) {
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-pill border px-2 py-0.5 text-caption font-medium",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}
