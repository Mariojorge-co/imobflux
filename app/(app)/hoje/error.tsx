"use client";

import { RouteError } from "@/components/ui";

export default function HojeError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <RouteError
      description="O painel de hoje não pôde ser atualizado agora."
      title="Hoje"
      unstable_retry={unstable_retry}
    />
  );
}
