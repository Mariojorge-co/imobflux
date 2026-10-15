import { PageContainer, PageHeader } from "@/components/ui";
import { QuickRepliesManager } from "@/components/quick-replies/quick-replies-manager";
import { requireActiveAccess } from "@/lib/auth/dal";
import { getQuickReplyLibrary } from "@/lib/quick-replies/data";

export const dynamic = "force-dynamic";

// Aberta a todos os membros ativos (dono e atendentes): cada pessoa gerencia o que criou; o dono gerencia tudo.
export default async function QuickRepliesSettingsPage() {
  await requireActiveAccess();
  const library = await getQuickReplyLibrary();

  return (
    <PageContainer>
      <PageHeader title="Respostas rápidas" />
      <QuickRepliesManager initialLibrary={library} />
    </PageContainer>
  );
}
