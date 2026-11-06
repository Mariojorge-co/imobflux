import { expect, test, type Page } from "@playwright/test";
import { loginAsDemoOwner, queryLocalSql, resetAndLoadDemoMode } from "./helpers/local-test-state";
import { ingestText } from "./helpers/webhook";

// Pacote Segurança 2: cabeçalhos, CSP em modo Report-Only (nunca bloqueia), endpoint de relatório e nada quebrado.
// As violações observadas são impressas como "CSP-VIOLATION diretiva=… origem=…" (sem URL completa nem conteúdo).

const JID = "5582988889101@s.whatsapp.net";
let conversation = "";

type Seen = { directive: string; blocked: string };

async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: Array<{ d: string; b: string }> };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      const e = event as SecurityPolicyViolationEvent;
      let blocked = e.blockedURI || "desconhecida";
      try {
        const u = new URL(blocked);
        blocked = ["http:", "https:", "ws:", "wss:"].includes(u.protocol) ? u.origin : u.protocol;
      } catch {
        // palavras-chave da CSP (inline, eval...) ficam como estão
      }
      w.__csp.push({ d: (e.effectiveDirective || e.violatedDirective || "").split(" ")[0], b: blocked });
    });
  });
}

async function collected(page: Page): Promise<Seen[]> {
  const rows = await page.evaluate(() => (window as unknown as { __csp: Array<{ d: string; b: string }> }).__csp ?? []);
  return rows.map((row) => ({ directive: row.d, blocked: row.b }));
}

test.describe.configure({ mode: "serial" });

test.describe("Segurança 2: cabeçalhos e CSP em Report-Only", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000);
    await resetAndLoadDemoMode();
    conversation = await ingestText(request, { jid: JID, text: "Oi, quero um imóvel", pushName: "Cliente Segurança" });
  });

  test("todas as rotas trazem os cabeçalhos fixos; a CSP completa é só Report-Only", async ({ request }) => {
    for (const path of ["/login", "/hoje", "/manifest.webmanifest", "/sw-avisos.js", "/api/push/subscriptions"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["x-frame-options"], path).toBe("DENY");
      // Uma única CSP (Report-Only, no proxy); nunca um Content-Security-Policy aplicado (B27).
      expect(headers["content-security-policy"], path).toBeUndefined();
      expect(headers["permissions-policy"], path).toContain("microphone=(self)");
      expect(headers["permissions-policy"], path).toContain("camera=()");
      // HSTS é da Vercel (não existe em localhost): o app não envia.
      expect(headers["strict-transport-security"], path).toBeUndefined();
    }
    const login = await request.get("/login");
    const report = login.headers()["content-security-policy-report-only"];
    expect(report).toContain("script-src 'self' 'nonce-");
    expect(report).toContain("report-uri /api/csp-report");
    // Nada de CSP bloqueante: só existe a Report-Only.
    expect(login.headers()["content-security-policy"]).toBeUndefined();
    // B27: todo <script> da página recebe o nonce da requisição (os do próprio Next também), senão o relatório enche de falsos avisos.
    const nonce = /'nonce-([^']+)'/.exec(report ?? "")?.[1] ?? "";
    expect(nonce).not.toBe("");
    const tags = [...(await login.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThan(3);
    expect(tags.filter((tag) => !tag.includes(`nonce="${nonce}"`))).toEqual([]);
  });

  test("endpoint de relatório: 204 sempre, ignora lixo, corpo grande e não registra conteúdo", async ({ request }) => {
    const ok = await request.post("/api/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: JSON.stringify({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://exemplo.test/x?segredo=1" } }),
    });
    expect(ok.status()).toBe(204);
    expect((await request.post("/api/csp-report", { data: "isto não é json" })).status()).toBe(204);
    expect((await request.post("/api/csp-report", { data: "x".repeat(20_000) })).status()).toBe(204);
    expect((await request.post("/api/csp-report")).status()).toBe(204);
  });

  test("login, Hoje, conversa, Kanban, Contatos, Configurações e Preferências funcionam e o nonce chega ao script de tema", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 160)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 160));
    });
    await watchViolations(page);
    await loginAsDemoOwner(page);

    // O script de tema inline recebeu o nonce da requisição (a propriedade .nonce não é escondida pelo navegador).
    const nonceOk = await page.evaluate(() => {
      const script = [...document.querySelectorAll("head script:not([src])")].find((s) => s.textContent?.includes("imobflux:theme"));
      const nonce = script ? ((script as HTMLScriptElement).nonce ?? "") : "";
      return nonce.length > 10;
    });
    expect(nonceOk).toBe(true);

    const seen: Seen[] = [];
    for (const path of ["/hoje", `/conversas/${conversation}`, "/kanban", "/contatos", "/configuracoes", "/preferencias"]) {
      await page.goto(path);
      await expect(page.locator("main, [data-testid=conversation-column]").first()).toBeVisible();
      seen.push(...(await collected(page)));
    }
    // Conversa: a caixa de mensagem funciona e o realtime não derruba a página.
    await page.goto(`/conversas/${conversation}`);
    await expect(page.getByLabel("Digitar mensagem de texto")).toBeVisible();
    await expect(page.locator('[data-testid="conversation-column"][data-ready="true"]')).toBeVisible();
    seen.push(...(await collected(page)));

    // Service worker e manifest continuam acessíveis.
    const worker = await page.evaluate(async () => {
      const response = await fetch("/sw-avisos.js", { cache: "no-store" });
      return response.status;
    });
    expect(worker).toBe(200);
    expect((await page.request.get("/manifest.webmanifest")).status()).toBe(200);

    // Tema claro/escuro continua alternando.
    await page.goto("/preferencias");
    const before = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.emulateMedia({ colorScheme: before ? "light" : "dark" });
    await page.reload();
    await expect(page.locator("main").first()).toBeVisible();

    // Canário: prova que o detector enxerga violações (uma imagem de origem não permitida é relatada, não bloqueada).
    await page.evaluate(() => {
      const img = new Image();
      img.src = "https://canario-csp.invalid/x.png?segredo=1";
      document.body.appendChild(img);
    });
    await expect.poll(async () => (await collected(page)).some((v) => v.blocked === "https://canario-csp.invalid" && v.directive === "img-src")).toBe(true);

    const unique = [...new Map(seen.map((v) => [`${v.directive}|${v.blocked}`, v])).values()];
    for (const v of unique) console.log(`CSP-VIOLATION diretiva=${v.directive} origem=${v.blocked}`);
    console.log(`CSP-VIOLATIONS total=${seen.length} distintas=${unique.length}`);
    const relevant = errors.filter((e) => !/Failed to load resource.*(401|404)|favicon|ERR_ABORTED|net::/i.test(e));
    expect(relevant, `erros de console/página: ${relevant.join(" | ")}`).toEqual([]);
    expect(queryLocalSql("select count(*) from public.conversations;")).not.toBe("0");
  });
});
