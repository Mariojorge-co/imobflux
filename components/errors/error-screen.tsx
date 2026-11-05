import type { ReactNode } from "react";
import { AlertTriangle, FileQuestion } from "lucide-react";
import { classNames } from "@/lib/class-names";

// Tela cheia de erro/404 em português: sem mensagem técnica nem stack. Botões de 44 px e texto em tokens do tema (claro/escuro, AA).

export const ERROR_BUTTON_CLASSES =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-inline rounded-control border px-control-x py-control-y text-body font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
export const ERROR_PRIMARY_CLASSES = "border-primary bg-primary text-primary-foreground hover:bg-primary-hover";
export const ERROR_SECONDARY_CLASSES = "border-border-strong bg-surface text-text hover:bg-neutral-soft";

type ErrorScreenProps = {
  actions: ReactNode;
  description: string;
  kind?: "error" | "not-found";
  title: string;
};

export function ErrorScreen({ actions, description, kind = "error", title }: ErrorScreenProps) {
  const Icon = kind === "not-found" ? FileQuestion : AlertTriangle;
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background px-stack py-section text-text sm:px-page"
      data-testid={kind === "not-found" ? "not-found-screen" : "error-screen"}
    >
      <div
        className={classNames("w-full max-w-md space-y-section rounded-card border border-border bg-surface p-section text-center")}
        role={kind === "error" ? "alert" : undefined}
      >
        <p className="text-xl font-bold tracking-tight text-text">ImobFlux</p>
        <div className="mx-auto flex size-12 items-center justify-center rounded-control bg-neutral-soft text-neutral">
          <Icon aria-hidden="true" size={24} strokeWidth={1.8} />
        </div>
        <div className="space-y-1">
          <h1 className="text-page-title font-semibold tracking-tight text-text">{title}</h1>
          <p className="text-body text-text-muted">{description}</p>
        </div>
        <div className="flex flex-col gap-inline sm:flex-row sm:justify-center">{actions}</div>
      </div>
    </main>
  );
}
