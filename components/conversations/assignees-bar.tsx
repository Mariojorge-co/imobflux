"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCheck, X } from "lucide-react";
import {
  assignConversationAction,
  reassignConversationAction,
  unassignConversationAction,
} from "@/lib/conversations/actions";
import {
  assignableMembers,
  type ConversationAssignee,
  type DirectoryMember,
} from "@/lib/conversations/assignment";

type AssigneesBarProps = {
  conversationId: string;
  /** 'commercial' = visível à equipe; qualquer outro valor limita as opções ao proprietário. */
  visibility: string;
  assignees: ConversationAssignee[];
  members: DirectoryMember[];
};

const selectClass =
  "min-h-11 rounded-control border border-border bg-surface px-2 text-caption text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-8";

/**
 * Responsáveis da conversa (fluxos 18 e 19). Atribuir indica responsabilidade e não muda quem
 * enxerga a conversa; o banco recusa membros inativos e conversas que o membro não poderia ver.
 */
export function AssigneesBar({ conversationId, visibility, assignees: initialAssignees, members }: AssigneesBarProps) {
  const router = useRouter();
  const [assignees, setAssignees] = useState(initialAssignees);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = assignableMembers(members, assignees, visibility);
  const nameOf = (memberId: string) => members.find((member) => member.member_id === memberId)?.display_name ?? "Membro";

  const run = (action: () => Promise<{ success: boolean; error?: string }>, apply: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        setError(result.error ?? "Não foi possível alterar o responsável.");
        return;
      }
      apply();
      router.refresh();
    });
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-caption" data-testid="assignees-bar">
      <span className="flex items-center gap-1 text-text-muted" title="Responsáveis pela conversa">
        <UserCheck aria-hidden="true" size={14} />
        <span className="max-2xl:sr-only">Resp.:</span>
      </span>

      {assignees.length === 0 ? <span className="text-text-muted max-2xl:sr-only" data-testid="assignees-empty">ninguém ainda</span> : null}

      {assignees.map((assignee) => {
        const swapOptions = options.filter((member) => member.member_id !== assignee.member_id);
        return (
          <span className="inline-flex items-center gap-1 rounded-pill border border-border bg-neutral-soft py-0.5 pl-2.5 pr-1" data-testid="assignee-chip" key={assignee.member_id}>
            <span className="font-medium text-text">{assignee.display_name ?? nameOf(assignee.member_id)}</span>
            {swapOptions.length > 0 ? (
              <select
                aria-label={`Passar a conversa de ${assignee.display_name ?? "membro"} para outro membro`}
                className="max-w-20 rounded-control bg-transparent text-caption text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                disabled={isPending}
                onChange={(event) => {
                  const toId = event.target.value;
                  if (!toId) return;
                  run(
                    () => reassignConversationAction(conversationId, assignee.member_id, toId),
                    () =>
                      setAssignees((current) => {
                        const without = current.filter((item) => item.member_id !== assignee.member_id);
                        return without.some((item) => item.member_id === toId)
                          ? without
                          : [...without, { member_id: toId, display_name: nameOf(toId) }];
                      }),
                  );
                }}
                value=""
              >
                <option value="">Trocar…</option>
                {swapOptions.map((member) => (
                  <option key={member.member_id} value={member.member_id}>{member.display_name}</option>
                ))}
              </select>
            ) : null}
            <button
              aria-label={`Remover ${assignee.display_name ?? "membro"} dos responsáveis`}
              className="flex size-6 items-center justify-center rounded-full text-text-muted hover:bg-border hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              disabled={isPending}
              onClick={() =>
                run(
                  () => unassignConversationAction(conversationId, assignee.member_id),
                  () => setAssignees((current) => current.filter((item) => item.member_id !== assignee.member_id)),
                )
              }
              type="button"
            >
              <X aria-hidden="true" size={12} />
            </button>
          </span>
        );
      })}

      {options.length > 0 ? (
        <select
          aria-label="Atribuir um responsável à conversa"
          className={selectClass}
          disabled={isPending}
          onChange={(event) => {
            const memberId = event.target.value;
            if (!memberId) return;
            run(
              () => assignConversationAction(conversationId, memberId),
              () => setAssignees((current) => (current.some((item) => item.member_id === memberId) ? current : [...current, { member_id: memberId, display_name: nameOf(memberId) }])),
            );
          }}
          value=""
        >
          <option value="">Atribuir a…</option>
          {options.map((member) => (
            <option key={member.member_id} value={member.member_id}>
              {member.display_name}{member.role === "owner" ? " (proprietário)" : ""}
            </option>
          ))}
        </select>
      ) : null}

      {error ? <span className="basis-full text-danger" role="alert">{error}</span> : null}
    </div>
  );
}
