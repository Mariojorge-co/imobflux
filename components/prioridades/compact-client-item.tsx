import { Avatar, Badge } from "@/components/ui";
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

type CompactClientItemProps = {
  client: PriorityClient;
  labelOverride?: string;
  useCreatedAt?: boolean;
};

export function CompactClientItem({
  client,
  labelOverride,
  useCreatedAt = false,
}: CompactClientItemProps) {
  const dateToUse = useCreatedAt ? client.created_at : client.updated_at;
  const formattedDate = formatRelativeTime(
    dateToUse,
    labelOverride || "Atualizado",
  );

  return (
    <article className="flex items-start gap-stack p-stack sm:p-card">
      <Avatar name={client.display_name} size="sm" />
      <div className="min-w-0 flex-1">
        <h3 className="text-body font-semibold text-text">
          {client.display_name}
        </h3>
        <p className="mt-1 text-caption text-text-muted">{formattedDate}</p>
        <div className="mt-inline flex flex-wrap items-center gap-inline">
          <Badge tone={classificationTones[client.classification]}>
            {classificationLabels[client.classification]}
          </Badge>
        </div>
      </div>
    </article>
  );
}
