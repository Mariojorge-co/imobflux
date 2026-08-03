import type { ReactNode } from "react";
import { Card } from "@/components/ui";

type AuthCardProps = {
  children: ReactNode;
  description: string;
  title: string;
};

export function AuthCard({ children, description, title }: AuthCardProps) {
  return (
    <Card className="w-full max-w-md space-y-section">
      <header className="space-y-inline text-center">
        <p className="text-xl font-bold tracking-tight text-text">ImobFlux</p>
        <div className="space-y-1">
          <h1 className="text-page-title font-semibold tracking-tight text-text">
            {title}
          </h1>
          <p className="text-body text-text-muted">{description}</p>
        </div>
      </header>
      {children}
    </Card>
  );
}
