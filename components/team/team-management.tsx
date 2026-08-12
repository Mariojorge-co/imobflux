"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, UserRound } from "lucide-react";
import {
  deactivateMemberAction,
  inviteMemberAction,
  reactivateMemberAction,
  resendInviteAction,
  type TeamActionResult,
} from "@/app/(app)/configuracoes/equipe/actions";
import { Badge, Button, Card, Input } from "@/components/ui";
import type { TeamMember } from "@/lib/team/data";

type TeamManagementProps = { members: TeamMember[] };

const statusPresentation = {
  active: { label: "Ativo", tone: "success" },
  invited: { label: "Convite pendente", tone: "warning" },
  suspended: { label: "Inativo", tone: "neutral" },
} as const;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

export function TeamManagement({ members }: TeamManagementProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<TeamActionResult | null>(null);

  function run(action: () => Promise<TeamActionResult>) {
    setFeedback(null);
    startTransition(async () => setFeedback(await action()));
  }

  function submitInvitation(formData: FormData) {
    run(async () => {
      const result = await inviteMemberAction(formData);
      if (result.status !== "error") dialogRef.current?.close();
      return result;
    });
  }

  return (
    <div className="space-y-stack">
      <div className="flex flex-wrap items-center justify-between gap-inline">
        <p className="text-body text-text-muted">Gerencie quem pode acessar este workspace.</p>
        <Button className="min-h-11" onClick={() => dialogRef.current?.showModal()}>
          <Plus aria-hidden="true" size={18} />
          Adicionar funcionário
        </Button>
      </div>

      {feedback ? (
        <p
          aria-live="polite"
          className={feedback.status === "error" ? "text-body text-danger" : feedback.status === "warning" ? "text-body text-warning" : "text-body text-success"}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}

      <div className="hidden overflow-hidden rounded-card border border-border bg-surface md:block">
        <table className="w-full border-collapse text-left text-body">
          <thead className="bg-neutral-soft text-text-muted">
            <tr>
              <th className="px-card py-control-y font-medium">Funcionário</th>
              <th className="px-card py-control-y font-medium">Papel</th>
              <th className="px-card py-control-y font-medium">Status</th>
              <th className="px-card py-control-y font-medium">Entrada ou convite</th>
              <th className="px-card py-control-y text-right font-medium">Ação</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <TeamRow key={member.id} member={member} pending={pending} run={run} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-inline md:hidden">
        {members.map((member) => (
          <TeamCard key={member.id} member={member} pending={pending} run={run} />
        ))}
      </div>

      <dialog className="m-auto w-[min(92vw,30rem)] rounded-card border border-border bg-surface p-card text-text backdrop:bg-black/30" ref={dialogRef}>
        <form action={submitInvitation} className="space-y-stack">
          <div>
            <h2 className="text-lg font-semibold">Adicionar funcionário</h2>
            <p className="mt-1 text-body text-text-muted">O funcionário receberá um convite para criar a própria senha.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-body font-medium" htmlFor="team-display-name">Nome</label>
            <Input id="team-display-name" name="displayName" required />
          </div>
          <div className="space-y-1.5">
            <label className="text-body font-medium" htmlFor="team-email">E-mail</label>
            <Input autoComplete="email" id="team-email" name="email" required type="email" />
          </div>
          <div className="flex flex-col-reverse gap-inline sm:flex-row sm:justify-end">
            <Button disabled={pending} onClick={() => dialogRef.current?.close()} type="button" variant="secondary">Cancelar</Button>
            <Button disabled={pending} type="submit">{pending ? "Criando convite..." : "Enviar convite"}</Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

type MemberPresentationProps = {
  member: TeamMember;
  pending: boolean;
  run: (action: () => Promise<TeamActionResult>) => void;
};

function MemberAction({ member, pending, run }: MemberPresentationProps) {
  if (member.role === "owner") return <span className="text-caption text-text-muted">Proprietário</span>;
  if (member.status === "invited") {
    return <Button disabled={pending} onClick={() => run(() => resendInviteAction(member.id))} variant="secondary">Reenviar convite</Button>;
  }
  if (member.status === "suspended") {
    return <Button disabled={pending} onClick={() => run(() => reactivateMemberAction(member.id))} variant="secondary">Reativar funcionário</Button>;
  }
  return (
    <Button
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Desativar acesso de ${member.displayName}?\n\nEle perderá acesso ao workspace, mas o histórico das ações realizadas será preservado.`)) {
          run(() => deactivateMemberAction(member.id));
        }
      }}
      variant="danger"
    >
      Desativar acesso
    </Button>
  );
}

function MemberIdentity({ member }: { member: TeamMember }) {
  return (
    <div className="flex min-w-0 items-center gap-inline">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-soft text-text-muted"><UserRound aria-hidden="true" size={18} /></span>
      <span className="min-w-0"><span className="block truncate font-medium text-text">{member.displayName}</span><span className="block truncate text-caption text-text-muted">{member.email}</span></span>
    </div>
  );
}

function TeamRow(props: MemberPresentationProps) {
  const { member } = props;
  const status = statusPresentation[member.status];
  return (
    <tr className="border-t border-border">
      <td className="px-card py-inline"><MemberIdentity member={member} /></td>
      <td className="px-card py-inline"><Badge tone={member.role === "owner" ? "info" : "neutral"}>{member.role.toUpperCase()}</Badge></td>
      <td className="px-card py-inline"><Badge tone={status.tone}>{status.label}</Badge></td>
      <td className="px-card py-inline text-text-muted">{formatDate(member.activatedAt ?? member.invitedAt ?? member.createdAt)}</td>
      <td className="px-card py-inline text-right"><MemberAction {...props} /></td>
    </tr>
  );
}

function TeamCard(props: MemberPresentationProps) {
  const { member } = props;
  const status = statusPresentation[member.status];
  return (
    <Card className="space-y-stack">
      <MemberIdentity member={member} />
      <div className="flex flex-wrap gap-inline"><Badge tone={member.role === "owner" ? "info" : "neutral"}>{member.role.toUpperCase()}</Badge><Badge tone={status.tone}>{status.label}</Badge></div>
      <p className="text-caption text-text-muted">Entrada ou convite: {formatDate(member.activatedAt ?? member.invitedAt ?? member.createdAt)}</p>
      <div className="[&>button]:min-h-11 [&>button]:w-full"><MemberAction {...props} /></div>
    </Card>
  );
}
