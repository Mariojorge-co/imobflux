import { ArrowUpRight } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  StatusChip,
  type BadgeTone,
  type StatusChipStatus,
} from "@/components/ui";
import { classNames } from "@/lib/class-names";
import type {
  PriorityClient,
  PriorityClientStatus,
  UrgencyLevel,
} from "@/types/prioridades";

const statusPresentation = {
  new: {
    label: "Novo contato",
    tone: "info",
  },
  waiting: {
    label: "Aguardando retorno",
    tone: "warning",
  },
  documentation: {
    label: "Documentação pendente",
    tone: "info",
  },
  "follow-up": {
    label: "Follow-up",
    tone: "neutral",
  },
  "at-risk": {
    label: "Em risco",
    tone: "danger",
  },
} satisfies Record<
  PriorityClientStatus,
  { label: string; tone: StatusChipStatus }
>;

const urgencyPresentation = {
  medium: {
    label: "Acompanhar",
    surface: "border-info-border bg-info-soft",
    tone: "info",
  },
  high: {
    label: "Alta prioridade",
    surface: "border-warning-border bg-warning-soft",
    tone: "warning",
  },
  critical: {
    label: "Atenção imediata",
    surface: "border-danger-border bg-danger-soft",
    tone: "danger",
  },
} satisfies Record<
  UrgencyLevel,
  { label: string; surface: string; tone: BadgeTone }
>;

type PriorityClientItemProps = {
  client: PriorityClient;
};

export function PriorityClientItem({ client }: PriorityClientItemProps) {
  const status = statusPresentation[client.status];
  const urgency = urgencyPresentation[client.urgency];

  return (
    <article className="p-stack sm:p-card">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-stack">
        <Avatar name={client.name} size="lg" />

        <div className="min-w-0">
          <div className="flex flex-col gap-stack sm:flex-row sm:items-start sm:justify-between">
            <h3 className="text-section-title font-semibold text-text">
              {client.name}
            </h3>

            <div
              className={classNames(
                "w-fit min-w-28 rounded-control border px-control-x py-control-y sm:text-right",
                urgency.surface,
              )}
            >
              <p className="text-caption font-medium text-text-muted">
                Tempo aguardando
              </p>
              <p className="mt-1 text-page-title font-semibold tracking-tight text-text">
                {client.waitingTime}
              </p>
            </div>
          </div>

          <div className="mt-stack grid gap-stack lg:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.25fr)]">
            <div className="rounded-control border border-border bg-background px-control-x py-control-y">
              <p className="text-caption font-medium text-text-muted">
                Próxima ação
              </p>
              <p className="mt-1 text-body font-semibold text-text">
                {client.nextAction}
              </p>
            </div>

            <div>
              <p className="max-w-2xl text-body text-text-muted">
                {client.context}
              </p>
              <div className="mt-inline flex flex-wrap items-center gap-inline">
                <StatusChip status={status.tone}>{status.label}</StatusChip>
                <Badge tone={urgency.tone}>{urgency.label}</Badge>
                <Badge>{client.channel}</Badge>
              </div>
            </div>
          </div>

          <div className="mt-stack flex justify-end border-t border-border pt-inline">
            <Button
              aria-label={`Abrir atendimento de ${client.name}`}
              className="min-h-11 px-2"
              variant="ghost"
            >
              Abrir atendimento
              <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
