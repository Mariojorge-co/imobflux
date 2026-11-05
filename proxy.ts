import type { NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";
import { buildCspReportOnly, generateNonce } from "@/lib/security/headers";

export async function proxy(request: NextRequest) {
  // As rotas /api devolvem JSON e não precisam de CSP; as páginas recebem a política em modo Report-Only (nunca bloqueia).
  if (request.nextUrl.pathname.startsWith("/api/")) return refreshSession(request);

  const nonce = generateNonce();
  const csp = buildCspReportOnly({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === "development",
  });
  // O Next lê o nonce do cabeçalho da requisição (aceita também o Report-Only) e o aplica aos próprios scripts; x-nonce leva o mesmo valor ao layout.
  const response = await refreshSession(request, { "content-security-policy-report-only": csp, "x-nonce": nonce });
  response.headers.set("Content-Security-Policy-Report-Only", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw-avisos\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
