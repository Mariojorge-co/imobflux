import { formatDateTime, formatYesNo, type CsvColumn } from "@/lib/export/csv";

type Row = Record<string, unknown>;

const CLASSIFICATION: Record<string, string> = { person: "Pessoa", lead: "Lead", client: "Cliente" };
const OPERATIONAL: Record<string, string> = { active: "Ativo", inactive: "Inativo" };
const REGISTRATION: Record<string, string> = { provisional: "Provisório", confirmed: "Confirmado" };
const OPPORTUNITY_STATUS: Record<string, string> = {
  open: "Aberta", won: "Ganha", lost: "Perdida", rework: "Retrabalho", cancelled: "Cancelada",
};

const translate = (map: Record<string, string>, value: unknown) =>
  typeof value === "string" ? (map[value] ?? value) : "";

export type ExportKind = "contacts" | "opportunities";

export type ExportDefinition = {
  kind: ExportKind;
  /** Trecho da URL (/api/export/<slug>) e do nome do arquivo. */
  slug: "contatos" | "oportunidades";
  label: string;
  columns: Array<CsvColumn<Row>>;
};

export const EXPORTS: Record<ExportDefinition["slug"], ExportDefinition> = {
  contatos: {
    kind: "contacts",
    slug: "contatos",
    label: "Contatos",
    columns: [
      { header: "Nome", value: (row) => row.display_name },
      { header: "Classificação", value: (row) => translate(CLASSIFICATION, row.classification) },
      { header: "Situação", value: (row) => translate(OPERATIONAL, row.operational_status) },
      { header: "Cadastro", value: (row) => translate(REGISTRATION, row.registration_status) },
      { header: "Protegido", value: (row) => formatYesNo(row.is_protected) },
      { header: "Telefones", value: (row) => row.phones },
      { header: "Criado em", value: (row) => formatDateTime(row.created_at) },
      { header: "Atualizado em", value: (row) => formatDateTime(row.updated_at) },
      { header: "Arquivado em", value: (row) => formatDateTime(row.archived_at) },
    ],
  },
  oportunidades: {
    kind: "opportunities",
    slug: "oportunidades",
    label: "Oportunidades",
    columns: [
      { header: "Título", value: (row) => row.title },
      { header: "Contato", value: (row) => row.contact_name },
      { header: "Etapa", value: (row) => row.stage_name },
      { header: "Situação", value: (row) => translate(OPPORTUNITY_STATUS, row.status) },
      { header: "Responsável", value: (row) => row.responsible_name },
      { header: "Origem", value: (row) => row.origin },
      { header: "Operação", value: (row) => row.operation_type },
      { header: "Tipo de imóvel", value: (row) => row.property_type_preference },
      { header: "Cidade/região", value: (row) => row.city_region_preference },
      { header: "Faixa de valor", value: (row) => row.value_range_preference },
      { header: "Prazo", value: (row) => row.timeframe_intent },
      { header: "Criada em", value: (row) => formatDateTime(row.created_at) },
      { header: "Atualizada em", value: (row) => formatDateTime(row.updated_at) },
      { header: "Encerrada em", value: (row) => formatDateTime(row.closed_at) },
      { header: "Arquivada em", value: (row) => formatDateTime(row.archived_at) },
    ],
  },
};

export function exportBySlug(slug: string): ExportDefinition | null {
  return Object.prototype.hasOwnProperty.call(EXPORTS, slug) ? EXPORTS[slug as ExportDefinition["slug"]] : null;
}
