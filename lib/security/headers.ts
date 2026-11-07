// Cabeçalhos de segurança do ImobFlux (Pacote Segurança 2). Funções puras, testadas em tests/security-headers.unit.spec.ts.
//
// - Cabeçalhos fixos (valem para todas as rotas): ver `staticSecurityHeaders`.
// - Content-Security-Policy SOMENTE em modo Report-Only neste pacote: nada é bloqueado, só relatado em /api/csp-report.
// - Strict-Transport-Security NÃO é definido aqui: a Vercel já envia (max-age=63072000; includeSubDomains; preload). Duplicar
//   mudaria o valor que o navegador guarda e pode conflitar com o da plataforma.

export type HeaderEntry = { key: string; value: string };

export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * Permissions-Policy: o microfone é do próprio site (mensagem de voz); câmera, localização e o resto que o app não usa ficam
 * negados. Notificações/Push não dependem desta política.
 */
export const PERMISSIONS_POLICY = [
  "microphone=(self)",
  "camera=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "midi=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "display-capture=()",
  "browsing-topics=()",
].join(", ");

export function staticSecurityHeaders(): HeaderEntry[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Anti-enquadramento aplicado: X-Frame-Options SAMEORIGIN (o visualizador de PDF enquadra /api/attachments no próprio site; DENY bloqueava até isso). Terceiros continuam sem poder embutir o app. NÃO existe cabeçalho Content-Security-Policy fixo aqui: na Vercel ele
    // ficava na frente da política Report-Only e o Next, que lê o nonce do primeiro dos dois, deixava de pôr o nonce nos próprios
    // scripts (B27). A CSP é uma só, Report-Only, montada no proxy.ts com o nonce da requisição.
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
}

/** Origem (esquema + host) de uma URL, ou null se não for http(s). */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** Origem websocket (wss/ws) correspondente à origem http(s) do Supabase (realtime). */
export function websocketOriginOf(origin: string | null): string | null {
  if (!origin) return null;
  return origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Política de conteúdo (Report-Only). O que o app usa de verdade:
 * - scripts: os do próprio Next (com nonce; 'strict-dynamic' carrega os pacotes que eles pedem) e o script de tema inline (com nonce);
 * - estilos: do próprio site e inline (React/Tailwind usam atributos style; o nonce não cobre atributos);
 * - imagens: do site, blob: e data: (prévia de anexos, avatares) e o Storage do Supabase (URLs assinadas);
 * - mídia: áudio/vídeo do site (/api/attachments), blob: (gravação de voz e prévias) e o Supabase;
 * - conexões do navegador: o site, o Supabase por https e wss (realtime);
 * - service worker e manifest: do próprio site.
 */
export function buildCspReportOnly(options: { nonce: string; supabaseUrl?: string | null; development?: boolean }): string {
  const supabase = originOf(options.supabaseUrl);
  const supabaseWs = websocketOriginOf(supabase);
  const scriptSrc = ["'self'", `'nonce-${options.nonce}'`, "'strict-dynamic'", ...(options.development ? ["'unsafe-eval'"] : [])];
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:", ...(supabase ? [supabase] : [])]],
    ["media-src", ["'self'", "blob:", ...(supabase ? [supabase] : [])]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(supabase ? [supabase] : []), ...(supabaseWs ? [supabaseWs] : [])]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
    ["report-uri", [CSP_REPORT_PATH]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}
