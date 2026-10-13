import "server-only";
import { normalizeInstanceState, phoneFromJid, type InstanceState } from "@/lib/whatsapp/channel";

export type EvolutionFailure =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE";

export type EvolutionResult<T> = { ok: true; data: T } | { ok: false; code: EvolutionFailure };

/** QR code pronto para exibir: sempre uma imagem data URL validada (nunca HTML). */
export type EvolutionQr = { image: string; code: string | null };

type EnvLike = Record<string, string | undefined>;
export type EvolutionOptions = { fetchImpl?: typeof fetch; timeoutMs?: number; env?: EnvLike };

const QR_IMAGE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_QR_CHARS = 200_000;

export function isEvolutionConfigured(env: EnvLike = process.env): boolean {
  return Boolean(env.EVOLUTION_API_URL?.trim() && env.EVOLUTION_API_KEY?.trim());
}

async function evolutionRequest(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body: unknown,
  options: EvolutionOptions,
): Promise<EvolutionResult<unknown> & { status?: number }> {
  const env = options.env ?? process.env;
  const apiUrl = env.EVOLUTION_API_URL?.trim();
  const apiKey = env.EVOLUTION_API_KEY?.trim();
  if (!apiUrl || !apiKey) return { ok: false, code: "NOT_CONFIGURED" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(`${apiUrl.replace(/\/+$/, "")}${path}`, {
      method,
      headers: { "Content-Type": "application/json", apikey: apiKey },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (response.status === 401) return { ok: false, code: "UNAUTHORIZED", status: 401 };
    if (response.status === 404) return { ok: false, code: "NOT_FOUND", status: 404 };
    if (!response.ok) return { ok: false, code: "HTTP_ERROR", status: response.status };
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, code: "INVALID_RESPONSE", status: response.status };
    }
    return { ok: true, data, status: response.status };
  } catch (error) {
    return { ok: false, code: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

/** Aceita a imagem do QR com ou sem prefixo data URL; rejeita qualquer outra coisa. */
export function parseQr(value: unknown): EvolutionQr | null {
  const source = value as { base64?: unknown; code?: unknown } | null;
  const raw = typeof source?.base64 === "string" ? source.base64.trim() : "";
  if (!raw || raw.length > MAX_QR_CHARS) return null;
  const image = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  if (!QR_IMAGE.test(image)) return null;
  const code = typeof source?.code === "string" && source.code.length <= 2_000 ? source.code : null;
  return { image, code };
}

/** Cria a instância (idempotente: já existente não é erro) e devolve o QR quando vier na criação. */
export async function createInstance(name: string, options: EvolutionOptions = {}): Promise<EvolutionResult<{ created: boolean; qr: EvolutionQr | null }>> {
  const result = await evolutionRequest("POST", "/instance/create", { instanceName: name, qrcode: true, integration: "WHATSAPP-BAILEYS" }, options);
  if (result.ok) {
    return { ok: true, data: { created: true, qr: parseQr((result.data as { qrcode?: unknown } | null)?.qrcode) } };
  }
  if (result.code === "HTTP_ERROR" && result.status === 403) {
    // 403 "name already in use": a instância já existe, o que é o esperado ao reconectar.
    return { ok: true, data: { created: false, qr: null } };
  }
  return { ok: false, code: result.code };
}

/** Pede um QR novo para uma instância existente. Sem QR (ex.: já conectada) devolve qr = null. */
export async function connectInstance(name: string, options: EvolutionOptions = {}): Promise<EvolutionResult<{ qr: EvolutionQr | null }>> {
  const result = await evolutionRequest("GET", `/instance/connect/${encodeURIComponent(name)}`, undefined, options);
  if (!result.ok) return { ok: false, code: result.code };
  return { ok: true, data: { qr: parseQr(result.data) } };
}

export async function getInstanceState(name: string, options: EvolutionOptions = {}): Promise<EvolutionResult<InstanceState>> {
  const result = await evolutionRequest("GET", `/instance/connectionState/${encodeURIComponent(name)}`, undefined, options);
  if (!result.ok) return { ok: false, code: result.code };
  const data = result.data as { instance?: { state?: unknown }; state?: unknown } | null;
  const state = data?.instance?.state ?? data?.state;
  if (typeof state !== "string") return { ok: false, code: "INVALID_RESPONSE" };
  return { ok: true, data: normalizeInstanceState(state) };
}

/** Número pareado (E.164) a partir do ownerJid/number da instância; null se ainda não houver. */
export async function getInstanceNumber(name: string, options: EvolutionOptions = {}): Promise<EvolutionResult<string | null>> {
  const result = await evolutionRequest("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`, undefined, options);
  if (!result.ok) return { ok: false, code: result.code };
  const list = Array.isArray(result.data) ? result.data : [result.data];
  const instance = list.find((item) => item && typeof item === "object") as { ownerJid?: unknown; number?: unknown; name?: unknown } | undefined;
  if (!instance) return { ok: false, code: "INVALID_RESPONSE" };
  return { ok: true, data: phoneFromJid(instance.ownerJid) ?? phoneFromJid(typeof instance.number === "string" ? `${instance.number}@s.whatsapp.net` : null) };
}

/** Aponta o webhook da instância para o app (mensagens e mudanças de conexão) com o segredo. */
export async function setInstanceWebhook(
  name: string,
  config: { url: string; secret: string; base64?: boolean },
  options: EvolutionOptions = {},
): Promise<EvolutionResult<true>> {
  const webhook = {
    enabled: true,
    url: config.url,
    byEvents: false,
    base64: config.base64 ?? false,
    headers: { "x-evolution-secret": config.secret },
    // MESSAGES_SET traz o histórico recente que o WhatsApp envia uma única vez, no pareamento.
    events: ["MESSAGES_UPSERT", "MESSAGES_SET", "CONNECTION_UPDATE"],
  };
  const path = `/webhook/set/${encodeURIComponent(name)}`;
  let result = await evolutionRequest("POST", path, { webhook }, options);
  if (!result.ok && result.code === "HTTP_ERROR" && result.status === 400) {
    // Algumas versões esperam o objeto sem o envelope "webhook".
    result = await evolutionRequest("POST", path, webhook, options);
  }
  return result.ok ? { ok: true, data: true } : { ok: false, code: result.code };
}

export async function logoutInstance(name: string, options: EvolutionOptions = {}): Promise<EvolutionResult<true>> {
  const result = await evolutionRequest("DELETE", `/instance/logout/${encodeURIComponent(name)}`, undefined, options);
  return result.ok ? { ok: true, data: true } : { ok: false, code: result.code };
}
