/** Aviso exibido ao OWNER quando a importação de histórico não termina. */
export const HISTORY_FAILURE_MESSAGE =
  "Importação de histórico não foi concluída, a partir de agora só mensagens novas serão capturadas.";

/** Depois desse prazo sem o último lote, a importação é dada como não concluída. */
export const HISTORY_IMPORT_TIMEOUT_MS = 10 * 60 * 1000;

export type HistoryImportRow = {
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  importedCount: number;
  error: string | null;
};

export type HistoryImportView =
  | { state: "none" }
  | { state: "importing"; importedCount: number }
  | { state: "completed"; importedCount: number }
  | { state: "failed"; importedCount: number; reason: "error" | "timeout"; detail: string | null };

/**
 * Estado da importação como o OWNER deve ver. "importing" por mais de 10 minutos vira falha:
 * pode ser lote recusado no caminho, erro no pareamento ou um número sem histórico para enviar.
 */
export function resolveHistoryImport(row: HistoryImportRow | null, now: number = Date.now()): HistoryImportView {
  if (!row || !row.status) return { state: "none" };
  if (row.status === "completed") return { state: "completed", importedCount: row.importedCount };
  if (row.status === "failed") {
    return { state: "failed", importedCount: row.importedCount, reason: "error", detail: row.error };
  }
  if (row.status === "importing") {
    const started = row.startedAt ? new Date(row.startedAt).getTime() : NaN;
    if (!Number.isNaN(started) && now - started > HISTORY_IMPORT_TIMEOUT_MS) {
      return {
        state: "failed",
        importedCount: row.importedCount,
        reason: "timeout",
        detail: "O WhatsApp não terminou de enviar o histórico no prazo esperado.",
      };
    }
    return { state: "importing", importedCount: row.importedCount };
  }
  return { state: "none" };
}

/** O aviso de falha só aparece nos primeiros 7 dias depois do pareamento. */
export function shouldWarnAboutHistory(view: HistoryImportView, startedAt: string | null, now: number = Date.now()): boolean {
  if (view.state !== "failed") return false;
  const started = startedAt ? new Date(startedAt).getTime() : NaN;
  return Number.isNaN(started) || now - started < 7 * 24 * 60 * 60 * 1000;
}
