import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

const buttonVariants = {
  primary:
    "border-primary bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary:
    "border-border-strong bg-surface text-text hover:bg-neutral-soft",
  ghost:
    "border-transparent bg-transparent text-text-muted hover:bg-neutral-soft hover:text-text",
  danger:
    "border-danger bg-danger text-danger-foreground hover:bg-danger-hover",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
};

export function Button({
  className,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={classNames(
        "inline-flex min-h-11 items-center justify-center gap-inline rounded-control border px-control-x py-control-y text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
