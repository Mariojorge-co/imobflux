import type { ReactNode } from "react";
import { AppLayout } from "@/components/app-layout";
import { SlaSettingsProvider } from "@/components/conversations/sla-settings-context";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getSlaSettings } from "@/lib/conversations/sla-settings-data";

type ApplicationLayoutProps = {
  children: ReactNode;
};

export default async function ApplicationLayout({
  children,
}: ApplicationLayoutProps) {
  const access = await requireActiveAccess();
  const slaSettings = await getSlaSettings();

  return (
    <SlaSettingsProvider settings={slaSettings}>
      <AppLayout memberId={access.memberId} role={access.role}>{children}</AppLayout>
    </SlaSettingsProvider>
  );
}
