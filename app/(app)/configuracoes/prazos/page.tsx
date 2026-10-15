import { PageContainer, PageHeader } from "@/components/ui";
import { SlaSettingsForm } from "@/components/conversations/sla-settings-form";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { getSlaSettings } from "@/lib/conversations/sla-settings-data";

export const dynamic = "force-dynamic";

// Só o proprietário define os prazos do workspace.
export default async function SlaSettingsPage() {
  await requireOwnerAccess();
  const settings = await getSlaSettings();

  return (
    <PageContainer>
      <PageHeader title="Prazos" />
      <SlaSettingsForm initial={settings} />
    </PageContainer>
  );
}
