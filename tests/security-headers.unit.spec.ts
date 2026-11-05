import { expect, test } from "@playwright/test";
import {
  CSP_REPORT_PATH,
  PERMISSIONS_POLICY,
  buildCspReportOnly,
  generateNonce,
  originOf,
  staticSecurityHeaders,
  websocketOriginOf,
} from "../lib/security/headers";
import { MAX_REPORT_BYTES, blockedOrigin, createRateLimiter, directiveName, parseCspReports, violationLine } from "../lib/security/csp-report";

test.describe("cabeçalhos de segurança", () => {
  test("fixos: nosniff, referrer, enquadramento e permissões", () => {
    const headers = Object.fromEntries(staticSecurityHeaders().map((h) => [h.key.toLowerCase(), h.value]));
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    // A única diretiva aplicada da CSP é frame-ancestors; a política completa fica em Report-Only.
    expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(headers["permissions-policy"]).toBe(PERMISSIONS_POLICY);
    // HSTS já vem da Vercel: não duplicar.
    expect(Object.keys(headers)).not.toContain("strict-transport-security");
  });

  test("Permissions-Policy permite o microfone do próprio site e nega câmera e localização", () => {
    expect(PERMISSIONS_POLICY).toContain("microphone=(self)");
    expect(PERMISSIONS_POLICY).toContain("camera=()");
    expect(PERMISSIONS_POLICY).toContain("geolocation=()");
  });

  test("origens: http(s) e websocket correspondente", () => {
    expect(originOf("https://abc.supabase.co/rest/v1/x?y=1")).toBe("https://abc.supabase.co");
    expect(originOf("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("")).toBeNull();
    expect(websocketOriginOf("https://abc.supabase.co")).toBe("wss://abc.supabase.co");
    expect(websocketOriginOf("http://127.0.0.1:54321")).toBe("ws://127.0.0.1:54321");
    expect(websocketOriginOf(null)).toBeNull();
  });

  test("nonce: base64 diferente a cada chamada", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(a.length).toBeGreaterThanOrEqual(22);
    expect(a).not.toBe(b);
  });

  test("CSP Report-Only cobre o que o app usa e nunca é bloqueante por si só", () => {
    const csp = buildCspReportOnly({ nonce: "NONCE123", supabaseUrl: "https://abc.supabase.co" });
    expect(csp).toContain("script-src 'self' 'nonce-NONCE123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("img-src 'self' blob: data: https://abc.supabase.co");
    expect(csp).toContain("media-src 'self' blob: https://abc.supabase.co");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`);
  });

  test("em desenvolvimento acrescenta unsafe-eval (React) e sem Supabase não inventa origens", () => {
    const dev = buildCspReportOnly({ nonce: "N", supabaseUrl: undefined, development: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).toContain("connect-src 'self'; ");
    expect(dev).not.toContain("wss:");
  });
});

test.describe("relatório de violações da CSP", () => {
  test("origem bloqueada: só esquema e host, nunca caminho nem query", () => {
    expect(blockedOrigin("https://evil.example/path/segredo?token=abc#x")).toBe("https://evil.example");
    expect(blockedOrigin("wss://x.supabase.co/realtime/v1/websocket?apikey=zzz")).toBe("wss://x.supabase.co");
    expect(blockedOrigin("inline")).toBe("inline");
    expect(blockedOrigin("eval")).toBe("eval");
    expect(blockedOrigin("blob:https://imobflux.vercel.app/1234-abcd")).toBe("blob:");
    expect(blockedOrigin("data:image/png;base64,AAAA")).toBe("data:");
    expect(blockedOrigin("")).toBe("desconhecida");
    expect(blockedOrigin(42)).toBe("desconhecida");
    expect(blockedOrigin("###")).toBe("outra");
  });

  test("diretiva: só o nome", () => {
    expect(directiveName("script-src-elem 'self' 'nonce-abc'")).toBe("script-src-elem");
    expect(directiveName("IMG-SRC")).toBe("img-src");
    expect(directiveName("<script>")).toBe("desconhecida");
    expect(directiveName(undefined)).toBe("desconhecida");
  });

  test("formato clássico e Reporting API; descarta campos sensíveis", () => {
    const classic = parseCspReports({
      "csp-report": {
        "document-uri": "https://imobflux.vercel.app/conversas/123?q=Fulano",
        "blocked-uri": "https://cdn.exemplo.com/a.js?t=1",
        "effective-directive": "script-src-elem",
        "script-sample": "alert('texto da mensagem')",
      },
    });
    expect(classic).toEqual([{ directive: "script-src-elem", blocked: "https://cdn.exemplo.com" }]);
    const modern = parseCspReports([{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "blob:https://x/1" } }]);
    expect(modern).toEqual([{ directive: "img-src", blocked: "blob:" }]);
    const line = violationLine(classic[0]);
    expect(line).toBe("[csp-report] diretiva=script-src-elem origem=https://cdn.exemplo.com");
    expect(line).not.toMatch(/Fulano|conversas|texto da mensagem|t=1/);
  });

  test("lixo, vazio e listas enormes não quebram nem passam de 10 itens", () => {
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("x")).toEqual([]);
    expect(parseCspReports({})).toEqual([]);
    const many = Array.from({ length: 100 }, () => ({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "inline" } }));
    expect(parseCspReports(many)).toHaveLength(10);
    expect(MAX_REPORT_BYTES).toBe(8192);
  });

  test("limite de volume por janela", () => {
    let now = 0;
    const allow = createRateLimiter(3, 1000, () => now);
    expect([allow(), allow(), allow(), allow(), allow()]).toEqual([true, true, true, false, false]);
    now = 1500;
    expect(allow()).toBe(true);
  });
});
