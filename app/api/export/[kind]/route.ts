import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildCsv, fileDate } from "@/lib/export/csv";
import { exportBySlug } from "@/lib/export/datasets";

// A consulta e a montagem do CSV (até 5.000 linhas) cabem folgadamente; o teto evita estourar tempo/tamanho de resposta.
export const maxDuration = 30;

type ExportResult = { success?: boolean; rows?: Array<Record<string, unknown>>; truncated?: boolean } | null;

function plain(status: number, message?: string) {
  return new NextResponse(message ? JSON.stringify({ error: message }) : null, {
    status,
    headers: { "Cache-Control": "no-store", ...(message ? { "Content-Type": "application/json" } : {}) },
  });
}

/**
 * Exportação CSV (somente OWNER). A autorização é do banco (export_dataset): ele confere o papel,
 * aplica o isolamento por workspace e registra a exportação, ou a tentativa negada, na auditoria.
 * O arquivo nunca é guardado no servidor: é gerado na hora e entregue como download.
 */
export async function GET(request: Request, context: { params: Promise<{ kind: string }> }) {
  // Defesa em profundidade: um site de terceiros não deve conseguir disparar o download.
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return plain(403, "Origem não permitida.");

  const { kind } = await context.params;
  const definition = exportBySlug(kind);
  if (!definition) return plain(404);

  const supabase = await createServerSupabaseClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return plain(401, "Entre na sua conta para exportar.");

  const { data, error } = await supabase.rpc("export_dataset", { p_kind: definition.kind });
  if (error) {
    // 42501: sem vínculo ativo (sessão sem acesso). Qualquer outra coisa é falha nossa.
    return error.code === "42501" ? plain(401, "Entre na sua conta para exportar.") : plain(500, "Não foi possível gerar a exportação.");
  }

  const result = data as ExportResult;
  if (!result?.success) return plain(403, "Somente o proprietário pode exportar dados.");

  // Limitação conhecida: o evento de auditoria "success" é gravado pelo banco no momento em que ele entrega as
  // linhas ao app (não depois da resposta HTTP). É proposital: mover o registro para depois permitiria obter dados
  // sem rastro. Se a montagem do arquivo falhar depois disso, a auditoria indica "dados liberados", não "arquivo baixado".
  const csv = buildCsv(definition.columns, result.rows ?? []);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${definition.slug}-${fileDate()}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(result.truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}
