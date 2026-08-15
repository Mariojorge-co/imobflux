"use client";

import { RouteError } from "@/components/ui";

export default function PrioridadesError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <RouteError
      description="As prioridades não puderam ser atualizadas agora."
      title="Prioridades Operacionais"
      unstable_retry={unstable_retry}
    />
  );
}
