// Web Push: validação do corpo recebido do navegador (puro, testável sem rede).

export type PushPlatform = "ios" | "android" | "desktop";

export type SubscriptionInput = { endpoint: string; p256dh: string; auth: string; platform: PushPlatform | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const P256DH = /^[A-Za-z0-9_-]{80,100}$/;
const AUTH = /^[A-Za-z0-9_-]{16,32}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isPlatform(value: unknown): value is PushPlatform {
  return value === "ios" || value === "android" || value === "desktop";
}

export function isValidEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Corpo do `PushSubscription.toJSON()` do navegador, mais a plataforma que o aparelho informa. `null` = inválido. */
export function parseSubscriptionBody(body: unknown): SubscriptionInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null; platform?: unknown };
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  if (!isValidEndpoint(value.endpoint)) return null;
  if (typeof p256dh !== "string" || !P256DH.test(p256dh)) return null;
  if (typeof auth !== "string" || !AUTH.test(auth)) return null;
  return { endpoint: value.endpoint, p256dh, auth, platform: isPlatform(value.platform) ? value.platform : null };
}
