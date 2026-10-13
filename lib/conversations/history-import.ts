import { HISTORY_CHUNK_SIZE, type WebhookHistoryResult } from "@/lib/conversations/webhook";

import type { Json } from "@/types/database";
import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Só o `rpc` do cliente administrativo é usado aqui (facilita testar com um falso). */
export type RpcClient = Pick<ReturnType<typeof createAdminSupabaseClient>, "rpc">;

export type HistoryBatchSummary = {
  imported: number;
  duplicate: number;
  ignored: number;
  failed: number;
  firstError: string | null;
};

type BatchRpcResult = { imported?: number; duplicate?: number; ignored?: number; failed?: number; first_error?: string | null } | null;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function recordProgress(
  client: RpcClient,
  batch: WebhookHistoryResult,
  imported: number,
  error: string | null,
): Promise<void> {
  const { error: progressError } = await client.rpc("record_whatsapp_history_progress", {
    p_external_account_id: batch.instance,
    p_imported: imported,
    p_progress: batch.progress ?? undefined,
    p_is_latest: batch.isLatest,
    p_error: error ?? undefined,
  });
  if (progressError) throw new Error(`record_whatsapp_history_progress: ${progressError.message ?? "erro"}`);
}

/**
 * Importa um lote de histórico: grava em pedaços, soma o resultado e registra o andamento.
 * Qualquer problema vira erro registrado na conexão (o OWNER vê o aviso na tela) e, quando é
 * falha do banco, o erro sobe para o webhook responder 500 e a Evolution tentar de novo.
 */
export async function importHistoryBatch(client: RpcClient, batch: WebhookHistoryResult): Promise<HistoryBatchSummary> {
  const summary: HistoryBatchSummary = { imported: 0, duplicate: 0, ignored: 0, failed: 0, firstError: null };

  for (const part of chunk(batch.items, HISTORY_CHUNK_SIZE)) {
    const { data, error } = await client.rpc("ingest_whatsapp_history_batch", {
      p_external_account_id: batch.instance,
      p_messages: part as unknown as Json,
    });
    if (error) {
      const message = `Falha ao gravar um lote do histórico: ${error.message ?? "erro no banco"}`;
      try {
        await recordProgress(client, batch, summary.imported, message);
      } catch {
        // O erro original é o que importa; sem registro, o prazo da importação ainda acusa a falha.
      }
      throw new Error(message);
    }
    const result = data as BatchRpcResult;
    summary.imported += result?.imported ?? 0;
    summary.duplicate += result?.duplicate ?? 0;
    summary.ignored += result?.ignored ?? 0;
    summary.failed += result?.failed ?? 0;
    summary.firstError = summary.firstError ?? result?.first_error ?? null;
  }

  const itemError = summary.failed > 0
    ? `${summary.failed} mensagens do histórico não puderam ser gravadas${summary.firstError ? ` (${summary.firstError})` : ""}`
    : null;
  await recordProgress(client, batch, summary.imported, itemError);
  return summary;
}
