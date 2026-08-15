"use client";

import { RouteError } from "@/components/ui";

export default function ConversasError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <RouteError
      description="As conversas não puderam ser carregadas agora."
      title="Conversas"
      unstable_retry={unstable_retry}
    />
  );
}
