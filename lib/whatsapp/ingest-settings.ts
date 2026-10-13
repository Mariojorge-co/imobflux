/** Chaves de entrada do WhatsApp por conexão (migration 20260802005000). */
export type IngestSettings = {
  /** Grupos são gravados? (padrão: não) */
  ingestGroups: boolean;
  /** Modo de teste: só números já cadastrados em Contatos entram. */
  onlyKnownContacts: boolean;
  /** Dias de histórico importados ao parear (0 = nenhum). */
  historyWindowDays: number;
  /** Mensagens ignoradas por motivo (só contagens, sem número nem texto). */
  ignored: { groups: number; unknownContacts: number; invalidPhones: number };
};

export const DEFAULT_INGEST_SETTINGS: IngestSettings = {
  ingestGroups: false,
  onlyKnownContacts: false,
  historyWindowDays: 15,
  ignored: { groups: 0, unknownContacts: 0, invalidPhones: 0 },
};

/** Linha de channel_connections com as colunas de filtro (como o PostgREST devolve). */
export type IngestSettingsRow = {
  history_window_days?: number | null;
  ingest_groups?: boolean | null;
  ingest_only_known_contacts?: boolean | null;
  ignored_counts?: unknown;
};

function count(counts: unknown, key: string): number {
  if (!counts || typeof counts !== "object") return 0;
  const value = (counts as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function parseIngestSettings(row: IngestSettingsRow | null | undefined): IngestSettings {
  if (!row) return DEFAULT_INGEST_SETTINGS;
  const window = row.history_window_days;
  return {
    ingestGroups: row.ingest_groups === true,
    onlyKnownContacts: row.ingest_only_known_contacts === true,
    historyWindowDays: typeof window === "number" && window >= 0 && window <= 15 ? window : DEFAULT_INGEST_SETTINGS.historyWindowDays,
    ignored: {
      groups: count(row.ignored_counts, "group"),
      unknownContacts: count(row.ignored_counts, "unknown_contact"),
      invalidPhones: count(row.ignored_counts, "invalid_phone"),
    },
  };
}

export const INGEST_SETTINGS_COLUMNS = "status, history_window_days, ingest_groups, ingest_only_known_contacts, ignored_counts, created_at";

type Row = IngestSettingsRow & { status: string; created_at?: string };

/** A conexão "atual": a ativa; senão a mais recente que não foi substituída (igual à tela de conexão). */
export function pickCurrentConnection<T extends Row>(rows: T[] | null | undefined): T | null {
  if (!rows?.length) return null;
  const sorted = [...rows].filter((row) => row.status !== "replaced").sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return sorted.find((row) => row.status === "active") ?? sorted[0] ?? null;
}

/** A janela de histórico só muda antes do pareamento (é no pareamento que o WhatsApp envia o histórico). */
export function canChangeHistoryWindow(status: string | null | undefined): boolean {
  return !status || status === "configured";
}

/** Resumo em português do que o filtro ignorou (vazio quando nada foi ignorado). */
export function describeIgnored(ignored: IngestSettings["ignored"]): string[] {
  const lines: string[] = [];
  if (ignored.unknownContacts > 0) lines.push(`${ignored.unknownContacts} de números não cadastrados`);
  if (ignored.groups > 0) lines.push(`${ignored.groups} de grupos`);
  if (ignored.invalidPhones > 0) lines.push(`${ignored.invalidPhones} de números inválidos`);
  return lines;
}
