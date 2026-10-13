import { PageContainer, PageHeader } from "@/components/ui";
import { WhatsappConnection } from "@/components/whatsapp/whatsapp-connection";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { getWhatsappChannelStatus } from "@/lib/whatsapp/data";
import { isEvolutionConfigured } from "@/lib/whatsapp/evolution-instance";

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
      <WhatsappConnection
        configured={isEvolutionConfigured()}
        initial={channel ? { status: channel.status, phone: channel.phone, activatedAt: channel.activatedAt } : null}
      />
    </PageContainer>
  );
}
