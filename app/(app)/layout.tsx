import type { ReactNode } from "react";
import { AppLayout } from "@/components/app-layout";
import { requireActiveAccess } from "@/lib/auth/dal";

type ApplicationLayoutProps = {
  children: ReactNode;
};

export default async function ApplicationLayout({
  children,
}: ApplicationLayoutProps) {
  const access = await requireActiveAccess();

  return <AppLayout role={access.role}>{children}</AppLayout>;
}
