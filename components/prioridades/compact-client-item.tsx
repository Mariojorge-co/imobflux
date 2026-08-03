import { Avatar, Badge, type BadgeTone } from "@/components/ui";
import type {
  CompactPriorityClient,
  UrgencyLevel,
} from "@/types/prioridades";

const urgencyTones = {
  medium: "info",
  high: "warning",
  critical: "danger",
} satisfies Record<UrgencyLevel, BadgeTone>;

type CompactClientItemProps = {
  client: CompactPriorityClient;
};

export function CompactClientItem({ client }: CompactClientItemProps) {
  return (
    <article className="flex items-start gap-stack p-stack sm:p-card">
      <Avatar name={client.name} size="sm" />
      <div className="min-w-0 flex-1">
        <h3 className="text-body font-semibold text-text">{client.name}</h3>
        <p className="mt-1 text-caption font-medium text-text">
          {client.nextAction}
        </p>
        <p className="mt-inline text-caption text-text-muted">
          {client.context}
        </p>
        <div className="mt-inline flex flex-wrap items-center gap-inline">
          <Badge tone={urgencyTones[client.urgency]}>
            {client.timingLabel}
          </Badge>
          <Badge>{client.channel}</Badge>
        </div>
      </div>
    </article>
  );
}
