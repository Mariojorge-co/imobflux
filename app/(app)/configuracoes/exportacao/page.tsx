import { Download, ShieldCheck, TriangleAlert } from "lucide-react";
import { Card, PageContainer, PageHeader } from "@/components/ui";
import { requireOwnerAccess } from "@/lib/auth/dal";
import { EXPORTS, EXPORT_ROW_LIMIT, truncationNotice } from "@/lib/export/datasets";
import { getExportCounts } from "@/lib/export/data";

export const dynamic = "force-dynamic";

const DESCRIPTIONS: Record<keyof typeof EXPORTS, string> = {
  contatos: "Nome, classificação, situação, se é protegido, telefones e datas (inclui arquivados).",
  oportunidades: "Título, contato, etapa, situação, responsável, origem, operação, imóvel, cidade, faixa de valor, prazo e datas.",
};

export default async function ExportacaoPage() {
  await requireOwnerAccess();
  const counts = await getExportCounts();
  const totals = { contatos: counts.contacts, oportunidades: counts.opportunities };

  return (
    <PageContainer>
      <PageHeader
        description={`Baixe seus dados em planilha (CSV, abre no Excel e no Google Planilhas). Só o proprietário pode exportar. Cada arquivo traz até ${EXPORT_ROW_LIMIT.toLocaleString("pt-BR")} linhas.`}
        title="Exportar dados"
      />
      <section aria-label="Exportações disponíveis" className="space-y-stack">
        {Object.values(EXPORTS).map((item) => {
          const total = totals[item.slug];
          const notice = truncationNotice(total);
          return (
            <Card className="space-y-stack" data-testid={`export-${item.slug}`} key={item.slug}>
              <div className="flex flex-col gap-stack sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-semibold text-text">
                    {item.label}
                    {total !== null ? <span className="ml-2 text-body font-normal text-text-muted">({total.toLocaleString("pt-BR")})</span> : null}
                  </h2>
                  <p className="text-body text-text-muted">{DESCRIPTIONS[item.slug]}</p>
                </div>
                <a
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-control bg-primary px-4 text-body font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  download
                  href={`/api/export/${item.slug}`}
                >
                  <Download aria-hidden="true" size={16} /> Baixar {item.label.toLowerCase()}
                </a>
              </div>
              {notice ? (
                <p className="flex items-start gap-2 rounded-control border border-warning-border bg-warning-soft p-card text-body text-warning" data-testid={`export-truncation-${item.slug}`} role="status">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
                  <span>{notice}</span>
                </p>
              ) : null}
            </Card>
          );
        })}
        <p className="flex items-start gap-2 text-caption text-text-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
          <span>
            Cada exportação fica registrada na auditoria (quem exportou e quantas linhas), sem copiar o conteúdo. Contatos
            protegidos aparecem marcados. Mensagens, notas e anexos não são exportados. O arquivo contém dados pessoais de
            clientes: guarde-o com cuidado.
          </span>
        </p>
      </section>
    </PageContainer>
  );
}
