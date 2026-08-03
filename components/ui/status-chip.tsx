import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

const statusStyles = {
  success: {
    chip: "border-success-border bg-success-soft text-success",
    indicator: "bg-success",
  },
  warning: {
    chip: "border-warning-border bg-warning-soft text-warning",
    indicator: "bg-warning",
  },
  danger: {
    chip: "border-danger-border bg-danger-soft text-danger",
    indicator: "bg-danger",
  },
  info: {
    chip: "border-info-border bg-info-soft text-info",
    indicator: "bg-info",
  },
  neutral: {
    chip: "border-neutral-border bg-neutral-soft text-neutral",
    indicator: "bg-neutral",
  },
} as const;

export type StatusChipStatus = keyof typeof statusStyles;

export type StatusChipProps = ComponentPropsWithRef<"span"> & {
  status?: StatusChipStatus;
};

export function StatusChip({
  children,
  className,
  status = "neutral",
  ...props
}: StatusChipProps) {
  const styles = statusStyles[status];

  return (
    <span
      className={classNames(
        "inline-flex items-center gap-inline rounded-pill border px-2 py-0.5 text-caption font-medium",
        styles.chip,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={classNames("size-1.5 rounded-pill", styles.indicator)}
      />
      {children}
    </span>
  );
}
