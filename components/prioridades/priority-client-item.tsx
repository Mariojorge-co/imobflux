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
      <article className="p-2.5 sm:p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar className="mt-0.5" name={client.display_name} size="sm" />

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h3 className="truncate text-sm font-semibold text-text">
                {client.display_name}
              </h3>
              {client.sla_text && (
                <span className="hidden max-w-[62%] shrink-0 truncate rounded-pill bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary sm:inline-block">
                  {client.sla_text}
                </span>
              )}
            </div>

            {client.sla_text && (
              <span className="mt-1 inline-block max-w-full truncate rounded-pill bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary sm:hidden">
                {client.sla_text}
              </span>
            )}

            <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-caption text-text-muted">
              <span className="min-w-0 truncate">
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
