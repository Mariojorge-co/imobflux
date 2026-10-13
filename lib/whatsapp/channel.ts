// Regras puras da conexão do WhatsApp (sem dependências de servidor, testáveis isoladamente).

export type InstanceState = "open" | "connecting" | "close";

/** Nome estável e único da instância Evolution deste workspace (só minúsculas, números e hífen). */
export function instanceNameForWorkspace(workspaceId: string): string {
  return `imobflux-${workspaceId.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 12)}`;
}

/** Converte o estado da Evolution em um dos três estados que o app entende. */
export function normalizeInstanceState(value: unknown): InstanceState {
  const state = typeof value === "string" ? value.toLowerCase() : "";
  if (state === "open") return "open";
  if (state === "connecting") return "connecting";
  return "close";
}

/** "5582999990000:12@s.whatsapp.net" → "+5582999990000" (E.164) ou null se não for um número válido. */
export function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string") return null;
  const digits = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : null;
}

export type WebhookUrlResult = { ok: true; url: string } | { ok: false; reason: "UNREACHABLE" };

type EnvLike = Record<string, string | undefined>;

/**
 * Endereço que a Evolution usa para entregar mensagens ao app. Em produção vem do domínio do
 * próprio app (https). WHATSAPP_WEBHOOK_BASE_URL permite apontar outro endereço (ex.: ambiente
 * local com Evolution em Docker). Sem isso, endereços locais/privados são recusados, porque a
 * Evolution não conseguiria alcançá-los.
 */
export function resolveWebhookUrl(input: { env?: EnvLike; host: string | null; proto: string | null }): WebhookUrlResult {
  const env = input.env ?? process.env;
  const override = env.WHATSAPP_WEBHOOK_BASE_URL?.trim();
  let base: string | null = null;

  if (override) {
    base = override;
  } else if (input.host) {
    let hostname: string;
    try {
      hostname = new URL(`https://${input.host}`).hostname.toLowerCase();
    } catch {
      return { ok: false, reason: "UNREACHABLE" };
    }
    const isLocal = hostname === "localhost" || hostname === "[::1]" || hostname.endsWith(".localhost")
      || /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)
      || /^169\.254\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    if (isLocal || input.proto === "http") return { ok: false, reason: "UNREACHABLE" };
    base = `https://${input.host}`;
  }
  if (!base) return { ok: false, reason: "UNREACHABLE" };

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return { ok: false, reason: "UNREACHABLE" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, reason: "UNREACHABLE" };
  return { ok: true, url: `${parsed.origin}/api/webhooks/whatsapp` };
}

/** Número E.164 para exibição: +55 (82) 99999-0000; outros países em grupos simples. */
export function formatConnectedPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const area = digits.slice(2, 4);
    const rest = digits.slice(4);
    const split = rest.length === 9 ? `${rest.slice(0, 5)}-${rest.slice(5)}` : `${rest.slice(0, 4)}-${rest.slice(4)}`;
    return `+55 (${area}) ${split}`;
  }
  return `+${digits}`;
}
