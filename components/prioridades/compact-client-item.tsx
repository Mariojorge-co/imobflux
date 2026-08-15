import Link from "next/link";
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
  const targetUrl = client.conversation_id
    ? `/conversas/${client.conversation_id}`
    : `/contatos?q=${encodeURIComponent(client.display_name)}`;

  return (
    <Link
      aria-label={client.conversation_id ? `Abrir conversa com ${client.display_name}` : `Abrir cadastro de ${client.display_name}`}
      className="block transition-colors hover:bg-neutral-soft/60 cursor-pointer"
      href={targetUrl}
    >
      <article className="flex min-w-0 items-start gap-2.5 p-3">
        <Avatar name={client.display_name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="truncate text-body font-semibold text-text">
              {client.display_name}
            </h3>
            {client.sla_text && (
              <span className="max-w-[50%] shrink-0 truncate rounded-pill bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary">
                {client.sla_text}
              </span>
            )}
          </div>
          <p className="mt-1 text-caption text-text-muted">{formattedDate}</p>
          <div className="mt-1 flex flex-wrap items-center gap-inline">
            <Badge tone={classificationTones[client.classification] || "neutral"}>
              {classificationLabels[client.classification] || "Contato"}
            </Badge>
          </div>
        </div>
      </article>
    </Link>
  );
}
