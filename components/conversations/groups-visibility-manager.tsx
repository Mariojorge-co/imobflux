"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Card } from "@/components/ui";
import { setGroupTeamVisibilityAction } from "@/lib/conversations/actions";

export type GroupRow = {
  id: string;
  name: string;
  lastActivityAt: string;
  visibility: string;
  archived: boolean;
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", { timeZone: "America/Maceio", dateStyle: "short", timeStyle: "short" });
}

/** Visão geral dos grupos: quais a equipe vê (liberados) e quais ficam só com o proprietário. */
export function GroupsVisibilityManager({ groups }: { groups: GroupRow[] }) {
  const [rows, setRows] = useState(groups);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = (row: GroupRow) => {
    const release = row.visibility !== "commercial";
    setError(null);
    setBusyId(row.id);
    startTransition(async () => {
      const result = await setGroupTeamVisibilityAction(row.id, release);
      if (result.success) {
        setRows((previous) => previous.map((item) => (item.id === row.id ? { ...item, visibility: release ? "commercial" : "owner_only" } : item)));
      } else {
        setError(result.error ?? "Não foi possível alterar o grupo.");
      }
      setBusyId(null);
    });
  };

  return (
    <div className="max-w-3xl space-y-stack">
      <p className="text-body text-text-muted">
        Cada grupo começa <strong>restrito ao proprietário</strong>. Ao liberar, a equipe passa a ver o grupo{" "}
        <strong>a partir daquele momento</strong> (nada do histórico anterior). Mensagens de contatos protegidos continuam
        ocultas para a equipe, mesmo em grupo liberado. Cada liberação fica registrada na auditoria.
      </p>

      {error ? (
        <p className="rounded-control bg-danger-soft px-3 py-2 text-caption font-medium text-danger" role="alert">{error}</p>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <p className="text-body text-text-muted" data-testid="groups-empty">Nenhum grupo recebido ainda.</p>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="groups-list">
          {rows.map((row) => {
            const released = row.visibility === "commercial";
            return (
              <li data-testid="group-row" key={row.id}>
                <Card className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <Link className="block truncate text-body font-semibold text-text hover:underline" href={`/conversas/${row.id}`}>
                      👥 {row.name}
                    </Link>
                    <p className="text-caption text-text-muted">
                      Última atividade {formatWhen(row.lastActivityAt)}
                      {row.archived ? " · encerrado" : ""}
                    </p>
                  </div>
                  <span
                    className={[
                      "rounded-full border px-2 py-0.5 text-caption font-medium",
                      released ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "border-border bg-neutral-soft text-text-muted",
                    ].join(" ")}
                    data-testid="group-state"
                  >
                    {released ? "Liberado para a equipe" : "Restrito ao dono"}
                  </span>
                  <Button disabled={busyId === row.id} onClick={() => toggle(row)} variant="secondary">
                    {released ? "Restringir ao dono" : "Liberar para a equipe"}
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
