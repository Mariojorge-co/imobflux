"use client";

import { useEffect, useState } from "react";
import { History, Loader2, TriangleAlert } from "lucide-react";
import { getHistoryImportStatusAction } from "@/app/(app)/configuracoes/whatsapp/actions";
import { HISTORY_FAILURE_MESSAGE, type HistoryImportView } from "@/lib/whatsapp/history-status";

const POLL_MS = 5_000;

/**
 * Situação da importação do histórico recente. A falha NUNCA é silenciosa: lote com erro, prazo
 * vencido ou pareamento sem histórico aparece aqui (e na tela de Conversas) em destaque.
 */
export function HistoryImportNotice({ initial }: { initial: HistoryImportView | null }) {
  const [view, setView] = useState<HistoryImportView | null>(initial);

  // Consulta ao montar (a conexão acabou de ser pareada) e enquanto estiver importando.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const result = await getHistoryImportStatusAction().catch(() => ({ ok: false as const }));
      if (cancelled) return;
      if (result.ok) setView(result.view);
      const keepPolling = !result.ok || result.view.state === "importing";
      if (keepPolling) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!view || view.state === "none") return null;

  if (view.state === "importing") {
    return (
      <div className="flex items-start gap-2 rounded-control border border-border bg-neutral-soft p-card text-body text-text" data-testid="history-importing" role="status">
        <Loader2 aria-hidden="true" className="mt-0.5 shrink-0 animate-spin" size={16} />
        <p>
          Importando o histórico recente do WhatsApp
          {view.importedCount > 0 ? ` (${view.importedCount} mensagens até agora)` : ""}… O WhatsApp envia esse histórico uma única vez, ao conectar.
        </p>
      </div>
    );
  }

  if (view.state === "completed") {
    return (
      <div className="flex items-start gap-2 rounded-control border border-border bg-neutral-soft p-card text-body text-text-muted" data-testid="history-completed">
        <History aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
        <p>
          {view.importedCount > 0
            ? `Histórico importado: ${view.importedCount} mensagens dos últimos 15 dias, marcadas como "histórico" nas conversas. Elas não contam no tempo de resposta.`
            : "O WhatsApp não enviou mensagens anteriores dos últimos 15 dias. A partir de agora, as mensagens novas são capturadas normalmente."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-control border border-warning-border bg-warning-soft p-card text-body text-warning" data-testid="history-failed" role="alert">
      <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
      <div className="space-y-1">
        <p className="font-semibold">{HISTORY_FAILURE_MESSAGE}</p>
        <p>
          {view.importedCount > 0
            ? `${view.importedCount} mensagens chegaram antes da interrupção e estão marcadas como histórico. `
            : ""}
          {view.detail ? `Motivo: ${view.detail} ` : ""}
          O WhatsApp só envia o histórico no pareamento. Para tentar de novo, desconecte e conecte o número outra vez.
        </p>
      </div>
    </div>
  );
}
