import type { ComponentPropsWithRef } from "react";
import { classNames } from "@/lib/class-names";

export type PageContainerProps = ComponentPropsWithRef<"div">;

export function PageContainer({
  className,
  ...props
}: PageContainerProps) {
  return (
    <div
      className={classNames(
        "w-full space-y-section px-stack py-stack sm:px-page sm:py-page",
        className,
      )}
      {...props}
    />
  );
}
