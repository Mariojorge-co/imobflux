"use client";

import { AlertTriangle } from "lucide-react";
import { Button, EmptyState, PageContainer, PageHeader } from "@/components/ui";

export default function ContactsError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <PageContainer>
      <PageHeader title="Contatos" />
      <EmptyState
        action={<Button onClick={unstable_retry}>Tentar novamente</Button>}
        description="Não foi possível carregar os contatos agora."
        icon={AlertTriangle}
        title="Ocorreu um erro"
      />
    </PageContainer>
  );
}
