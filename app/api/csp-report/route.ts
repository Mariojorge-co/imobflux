import { NextResponse, type NextRequest } from "next/server";
import { MAX_REPORT_BYTES, createRateLimiter, parseCspReports, violationLine } from "@/lib/security/csp-report";

// Recebe as violações da CSP (modo Report-Only). Registra só a diretiva e a origem bloqueada (sem URL completa, query ou conteúdo).
// Sempre responde 204: o navegador não tenta de novo e nada vaza. Corpo limitado e volume limitado por instância.

export const dynamic = "force-dynamic";

const allow = createRateLimiter(60, 60_000);

/** Lê o corpo até `max` bytes; acima disso devolve null sem ler o resto (corpo sem Content-Length também fica limitado). */
async function readLimited(request: NextRequest, max: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(request: NextRequest) {
  const empty = () => new NextResponse(null, { status: 204 });
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) return empty();
    if (!allow()) return empty();

    const text = await readLimited(request, MAX_REPORT_BYTES);
    if (text === null) return empty();
    for (const violation of parseCspReports(JSON.parse(text))) console.log(violationLine(violation));
  } catch {
    // Relatório malformado: ignorado em silêncio.
  }
  return empty();
}
