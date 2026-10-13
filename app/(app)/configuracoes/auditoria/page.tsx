import Link from "next/link";
import { ScrollText } from "lucide-react";
import { Badge, Card, EmptyState, PageContainer, PageHeader } from "@/components/ui";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { getAuditPage, getTeamNames } from "@/lib/audit/data";
import { AUDIT_CATEGORIES, describeAuditEvent } from "@/lib/audit/labels";
import { auditQueryString, parseAuditFilters } from "@/lib/audit/query";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Maceio",
});

const fieldClass = "min-h-11 w-full rounded-control border border-border bg-surface px-3 text-body text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export default async function AuditoriaPage({ searchParams }: PageProps) {
  await requireOwnerAccess();
  const filters = parseAuditFilters(await searchParams);
  const [page, team] = await Promise.all([getAuditPage(filters), getTeamNames()]);
  // Nomes vêm da própria consulta (inclui quem foi removido); a lista de equipe só alimenta o filtro "Pessoa".
  const names = new Map(Object.entries(page.memberNames));
  const views = page.events.map((event) => describeAuditEvent(event, names));
  const last = page.events.at(-1);
  const hasFilters = Boolean(filters.category || filters.actor || filters.from || filters.to);

  return (
    <PageContainer>
      <PageHeader
        description="Quem fez o quê nas ações sensíveis. Os registros são permanentes, não podem ser alterados e nunca guardam o conteúdo das conversas."
        title="Auditoria"
      />

      <form action="/configuracoes/auditoria" className="mb-stack grid gap-stack rounded-card border border-border bg-surface p-card sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="space-y-1 text-caption font-medium text-text-muted">
          Tipo
          <select className={fieldClass} defaultValue={filters.category ?? ""} name="categoria">
            <option value="">Todos</option>
            {AUDIT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-caption font-medium text-text-muted">
          Pessoa
          <select className={fieldClass} defaultValue={filters.actor ?? ""} name="pessoa">
            <option value="">Todas</option>
            {team.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-caption font-medium text-text-muted">
          De
          <input className={fieldClass} defaultValue={filters.from ?? ""} name="de" type="date" />
        </label>
        <label className="space-y-1 text-caption font-medium text-text-muted">
          Até
          <input className={fieldClass} defaultValue={filters.to ?? ""} name="ate" type="date" />
        </label>
        <div className="flex items-end gap-inline">
          <button className="min-h-11 flex-1 rounded-control bg-primary px-4 text-body font-medium text-primary-foreground hover:opacity-90" type="submit">Filtrar</button>
          {hasFilters ? (
            <Link className="inline-flex min-h-11 items-center rounded-control border border-border px-3 text-body text-text hover:bg-neutral-soft" href="/configuracoes/auditoria">Limpar</Link>
          ) : null}
        </div>
      </form>

      {views.length === 0 ? (
        <EmptyState
          data-testid="audit-empty"
          description={hasFilters ? "Nenhum registro com esses filtros. Ajuste o período ou o tipo." : "As ações sensíveis (equipe, atribuições, etapas, exportações…) aparecerão aqui."}
          icon={ScrollText}
          title={hasFilters ? "Nada encontrado" : "Nenhum registro ainda"}
        />
      ) : (
        <ul aria-label="Registros de auditoria" className="space-y-inline" data-testid="audit-list">
          {views.map((view) => (
            <li key={view.id}>
              <Card className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-stack" data-testid="audit-event">
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    {view.href ? <Link className="hover:underline" href={view.href}>{view.title}</Link> : view.title}
                  </p>
                  {view.detail ? <p className="text-body text-text-muted">{view.detail}</p> : null}
                  <p className="text-caption text-text-muted">por {view.actor}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-inline sm:flex-col sm:items-end">
                  <Badge tone={view.result === "success" ? "neutral" : "danger"}>{view.categoryLabel}</Badge>
                  <time className="text-caption text-text-muted" dateTime={view.when}>{dateTime.format(new Date(view.when))}</time>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {page.hasMore && last ? (
        <div className="mt-stack flex justify-center">
          <Link
            className="inline-flex min-h-11 items-center rounded-control border border-border px-4 text-body font-medium text-text hover:bg-neutral-soft"
            data-testid="audit-more"
            href={`/configuracoes/auditoria${auditQueryString(filters, { ts: last.occurred_at, id: last.id })}`}
          >
            Ver eventos mais antigos
          </Link>
        </div>
      ) : null}
    </PageContainer>
  );
}
