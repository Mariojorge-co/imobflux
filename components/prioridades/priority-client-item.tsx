import { Avatar, Badge, StatusChip } from "@/components/ui";
import { formatRelativeTime } from "@/lib/date";
import type { PriorityClient } from "@/types/prioridades";

const classificationLabels = {
  client: "Cliente",
  lead: "Lead",
  person: "Pessoa",
} as const;

const classificationTones = {
  client: "success",
  lead: "info",
  person: "neutral",
} as const;

type PriorityClientItemProps = {
  client: PriorityClient;
  labelOverride?: string;
  useCreatedAt?: boolean;
};

export function PriorityClientItem({
  client,
  labelOverride,
  useCreatedAt = false,
}: PriorityClientItemProps) {
  const dateToUse = useCreatedAt ? client.created_at : client.updated_at;
  const relativeTime = formatRelativeTime(dateToUse);

  return (
    <article className="p-stack sm:p-card">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-stack">
        <Avatar name={client.display_name} size="lg" />

        <div className="min-w-0">
          <div className="flex flex-col gap-stack sm:flex-row sm:items-start sm:justify-between">
            <h3 className="text-section-title font-semibold text-text">
              {client.display_name}
            </h3>
          </div>

          <div className="mt-stack grid gap-stack lg:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.25fr)]">
            <div className="rounded-control border border-border bg-background px-control-x py-control-y">
              <p className="text-caption font-medium text-text-muted">
                {labelOverride || "Última atualização"}
              </p>
              <p className="mt-1 text-body font-semibold text-text">
                {relativeTime}
              </p>
            </div>

            <div className="flex flex-col justify-center">
              <div className="flex flex-wrap items-center gap-inline">
                <StatusChip status="info">Ativo</StatusChip>
                <Badge tone={classificationTones[client.classification]}>
                  {classificationLabels[client.classification]}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
