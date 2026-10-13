import { PageContainer, PageHeader } from "@/components/ui";
import { WhatsappConnection } from "@/components/whatsapp/whatsapp-connection";
import { IngestSettingsCard } from "@/components/whatsapp/ingest-settings-card";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { getWhatsappChannelStatus } from "@/lib/whatsapp/data";
import { isEvolutionConfigured } from "@/lib/whatsapp/evolution-instance";
import { DEFAULT_INGEST_SETTINGS } from "@/lib/whatsapp/ingest-settings";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  await requireOwnerAccess();
  const channel = await getWhatsappChannelStatus();

  return (
    <PageContainer>
      <PageHeader
        description="Conecte o número de WhatsApp da imobiliária para receber e responder mensagens no ImobFlux."
        title="WhatsApp"
      />
      <IngestSettingsCard connectionStatus={channel?.status ?? null} initial={channel?.ingestSettings ?? DEFAULT_INGEST_SETTINGS} />
      <WhatsappConnection
        configured={isEvolutionConfigured()}
        initialHistory={channel?.historyImport ?? null}
        initial={channel ? { status: channel.status, phone: channel.phone, activatedAt: channel.activatedAt } : null}
      />
    </PageContainer>
  );
}
