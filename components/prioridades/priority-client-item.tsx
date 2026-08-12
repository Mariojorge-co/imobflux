import Link from "next/link";
import { Avatar } from "@/components/ui";
import { formatRelativeTime } from "@/lib/date";
import type { PriorityClient } from "@/types/prioridades";

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
  const targetUrl = client.conversation_id
    ? `/conversas/${client.conversation_id}`
    : `/contatos?q=${encodeURIComponent(client.display_name)}`;

  return (
    <Link
      aria-label={client.conversation_id ? `Abrir conversa com ${client.display_name}` : `Abrir cadastro de ${client.display_name}`}
      className="block transition-colors hover:bg-neutral-soft/60 cursor-pointer"
      href={targetUrl}
    >
      <article className="p-3">
        <div className="flex items-center gap-3">
          <Avatar name={client.display_name} size="md" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-text">
                {client.display_name}
              </h3>
              {client.sla_text && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {client.sla_text}
                </span>
              )}
            </div>

            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-text-muted">
              <span className="truncate">
                {labelOverride || "Última atualização"}
              </span>
              <time className="shrink-0 text-text-muted">{relativeTime}</time>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
