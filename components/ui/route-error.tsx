"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { PageContainer } from "./page-container";
import { PageHeader } from "./page-header";

type RouteErrorProps = {
  description: string;
  title: string;
  unstable_retry: () => void;
};

export function RouteError({ description, title, unstable_retry }: RouteErrorProps) {
  return (
    <PageContainer>
      <PageHeader title={title} />
      <EmptyState
        action={<Button onClick={unstable_retry}>Tentar novamente</Button>}
        description={description}
        icon={AlertTriangle}
        role="alert"
        title="Não foi possível carregar esta área"
      />
    </PageContainer>
  );
}
