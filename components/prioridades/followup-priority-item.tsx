"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CalendarClock } from "lucide-react";
import { completeWorkTaskAction, upsertWorkTaskAction } from "@/lib/conversations/actions";
import { formatFollowupPriorityLabel } from "@/lib/date";
import { Avatar, Button, Input } from "@/components/ui";

type FollowupPriorityItemProps = {
  followup: {
    id: string;
    title: string;
    due_at: string;
    contact_id: string;
    conversation_id: string | null;
    opportunity_id: string | null;
    display_name: string;
  };
};

export function FollowupPriorityItem({ followup }: FollowupPriorityItemProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const priorityLabel = formatFollowupPriorityLabel(followup.due_at);
  const isOverdue = priorityLabel.startsWith("Follow-up vencido");
  const targetUrl = followup.conversation_id
    ? `/conversas/${followup.conversation_id}${followup.opportunity_id ? `?opportunityId=${followup.opportunity_id}` : ""}`
    : `/contatos?q=${encodeURIComponent(followup.display_name)}`;

  return (
    <article className="space-y-2 p-2.5 sm:p-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Avatar className="mt-0.5" name={followup.display_name} size="sm" />
        <Link className="min-w-0 flex-1 hover:underline" href={targetUrl}>
          <h3 className="truncate text-sm font-semibold text-text">{followup.display_name}</h3>
          <p className="truncate text-caption text-text-muted">{followup.title}</p>
        </Link>
        <span
          className={[
            "max-w-[42%] shrink-0 truncate rounded-pill px-2 py-0.5 text-caption font-semibold sm:max-w-none",
            isOverdue
              ? "bg-danger-soft text-danger"
              : "bg-info-soft text-info",
          ].join(" ")}
          data-followup-state={isOverdue ? "overdue" : "today"}
        >
          {priorityLabel}
        </span>
      </div>

      {isRescheduling ? (
        <form
          className="flex flex-wrap items-end gap-2 sm:pl-10"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dueAt) return;
            startTransition(async () => {
              const result = await upsertWorkTaskAction({
                taskId: followup.id,
                taskType: "follow_up",
                title: followup.title,
                dueAt,
              });
              if (result.success) {
                setIsRescheduling(false);
                router.refresh();
              }
            });
          }}
        >
          <Input aria-label={`Novo vencimento de ${followup.display_name}`} onChange={(event) => setDueAt(event.target.value)} required type="datetime-local" value={dueAt} />
          <Button disabled={isPending} type="submit" variant="primary">Salvar</Button>
          <Button onClick={() => setIsRescheduling(false)} type="button" variant="ghost">Cancelar</Button>
        </form>
      ) : (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button onClick={() => setIsRescheduling(true)} type="button" variant="ghost"><CalendarClock size={14} /> Reagendar</Button>
          <Button
            disabled={isPending}
            onClick={() => startTransition(async () => {
              const result = await completeWorkTaskAction(followup.id, followup.conversation_id ?? undefined);
              if (result.success) router.refresh();
            })}
            type="button"
            variant="secondary"
          >
            <CheckCircle2 size={14} /> Concluir
          </Button>
        </div>
      )}
    </article>
  );
}
