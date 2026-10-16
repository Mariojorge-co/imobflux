import "server-only";
import {
  externalIdFrom,
  formatPhoneForEvolution,
  quotedPayload,
  type EvolutionQuoted,
  type SendEvolutionTextMessageResult,
} from "@/lib/supabase/gateway";

// Ações sobre mensagens já enviadas (editar, apagar para todos, reagir) e áudio de voz, pela Evolution API v2.3.7.
// Mesmo contrato de erros do envio de texto: só um código curto e uma frase fixa, nunca o corpo da resposta, o texto,
// o número, a chave de acesso nem o endereço do servidor.

export type EvolutionActionResult =
  | { success: true; externalMessageId: string | null }
  | { success: false; error: string; code: string };

type EvolutionCall = {
  method: "POST" | "DELETE";
  /** Caminho antes da instância, ex.: "/chat/updateMessage". */
  path: string;
  instanceName?: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
  /** Reação e áudio respondem com o `key.id`; sem ele o envio não é confiável. */
  expectsExternalId?: boolean;
};

/**
 * Registro de diagnóstico SEM conteúdo: nome da ação, status HTTP, quantidade de dígitos do JID usado e se ele mudou ao
 * ser resolvido, e os NOMES (não os valores) das chaves da resposta. Nunca texto de mensagem, número, chave ou URL.
 */
export function logEvolutionAction(action: string, info: Record<string, string | number | boolean | null | undefined>) {
  const parts = Object.entries(info).map(([key, value]) => `${key}=${value ?? "-"}`);
  console.log(`[evolution-action] ${action} ${parts.join(" ")}`);
}

function responseShape(data: unknown): string {
  if (!data || typeof data !== "object") return typeof data;
  if (Array.isArray(data)) return `array(${data.length})`;
  return Object.keys(data as Record<string, unknown>).slice(0, 8).join(",");
}

async function callEvolution(call: EvolutionCall): Promise<EvolutionActionResult> {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!apiUrl || !apiKey) {
    return { success: false, error: "Configuração da Evolution API ausente no ambiente", code: "MISSING_ENV_CONFIG" };
  }
  const activeInstance = call.instanceName?.trim() || process.env.EVOLUTION_INSTANCE_NAME?.trim();
  if (!activeInstance) {
    return { success: false, error: "Nome da instância do WhatsApp não informado", code: "MISSING_INSTANCE" };
  }

  const targetUrl = `${apiUrl.replace(/\/+$/, "")}${call.path}/${encodeURIComponent(activeInstance)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.timeoutMs ?? 15000);
  try {
    const response = await fetch(targetUrl, {
      method: call.method,
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(call.body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const actionName = call.path.split("/").pop() ?? call.path;
    if (!response.ok) {
      logEvolutionAction(actionName, { http: response.status });
      return { success: false, error: `Evolution API retornou erro HTTP ${response.status}`, code: `HTTP_${response.status}` };
    }
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const externalMessageId = externalIdFrom(data);
    logEvolutionAction(actionName, { http: response.status, shape: responseShape(data), has_key_id: Boolean(externalMessageId) });
    if (call.expectsExternalId && !externalMessageId) {
      return { success: false, error: "Resposta da Evolution API não continha o ID externo da mensagem", code: "MISSING_EXTERNAL_ID" };
    }
    return { success: true, externalMessageId };
  } catch (err: unknown) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "Tempo limite excedido na chamada ao WhatsApp", code: "TIMEOUT" };
    }
    return { success: false, error: "Falha de rede na comunicação com a Evolution API", code: "NETWORK_ERROR" };
  }
}

/** JID da conversa usado nas chaves de mensagem (individual ou grupo). */
function remoteJidOf(thread: string | undefined): string | null {
  const value = thread?.trim();
  return value && value.includes("@") ? value : null;
}

// ─── JID real do chat ─────────────────────────────────────────────────────────────────────────────
// Editar, apagar para todos e reagir precisam da chave EXATA da mensagem no WhatsApp (remoteJid + id + fromMe). O envio de
// texto não tem esse problema porque manda só o número e a Evolution descobre o JID. Já o JID guardado na conversa pode
// diferir do real: conversas iniciadas pelo ImobFlux guardam o celular com o 9º dígito (13 dígitos), enquanto o WhatsApp de
// quem tem número antigo usa o JID sem o 9 (12 dígitos). Com a chave errada a Evolution responde 2xx e o WhatsApp ignora.
// Por isso o JID é confirmado com POST /chat/whatsappNumbers/{instância} antes de agir; se a consulta falhar, usa o guardado.

const JID_CACHE_MS = 10 * 60 * 1000;
const jidCache = new Map<string, { jid: string; at: number }>();

export type ResolvedChatJid = { jid: string; resolved: boolean };

/** Forma normalizada de um JID individual ("5582...:12@s.whatsapp.net" -> "5582...@s.whatsapp.net"). */
export function normalizeIndividualJid(jid: string): string | null {
  const at = jid.indexOf("@");
  if (at < 0) return null;
  const user = jid.slice(0, at).split(":")[0].trim();
  const domain = jid.slice(at + 1).trim().toLowerCase();
  if (!/^[0-9]{8,20}$/.test(user)) return null;
  if (domain !== "s.whatsapp.net" && domain !== "lid") return null;
  return `${user}@${domain}`;
}

/** Extrai o JID da resposta de /chat/whatsappNumbers: lista de { exists, jid, number }. */
export function jidFromWhatsappNumbers(data: unknown): string | null {
  const list = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown } | null)?.data) ? ((data as { data: unknown[] }).data) : [];
  for (const item of list) {
    const entry = item as { exists?: unknown; jid?: unknown } | null;
    if (!entry || entry.exists === false || typeof entry.jid !== "string") continue;
    const jid = normalizeIndividualJid(entry.jid);
    if (jid) return jid;
  }
  return null;
}

export async function resolveChatJid(instanceName: string | undefined, thread: string | undefined): Promise<ResolvedChatJid | null> {
  const stored = remoteJidOf(thread);
  if (!stored) return null;
  const at = stored.indexOf("@");
  const domain = stored.slice(at + 1).toLowerCase();
  // Grupo, @lid e afins já são a chave real: não há o que resolver.
  if (domain !== "s.whatsapp.net" && domain !== "c.us") return { jid: stored, resolved: false };
  const digits = stored.slice(0, at).split(":")[0].trim();
  if (!/^[0-9]{8,20}$/.test(digits)) return { jid: stored, resolved: false };

  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = instanceName?.trim() || process.env.EVOLUTION_INSTANCE_NAME?.trim();
  if (!apiUrl || !apiKey || !instance) return { jid: stored, resolved: false };

  const cacheKey = `${instance}:${digits}`;
  const cached = jidCache.get(cacheKey);
  if (cached && Date.now() - cached.at < JID_CACHE_MS) return { jid: cached.jid, resolved: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiUrl.replace(/\/+$/, "")}/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ numbers: [digits] }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      logEvolutionAction("whatsappNumbers", { http: response.status });
      return { jid: stored, resolved: false };
    }
    const jid = jidFromWhatsappNumbers(await response.json().catch(() => null));
    logEvolutionAction("whatsappNumbers", {
      http: response.status,
      found: Boolean(jid),
      stored_digits: digits.length,
      real_digits: jid ? jid.split("@")[0].length : null,
      changed: jid ? jid !== `${digits}@s.whatsapp.net` : null,
    });
    if (!jid) return { jid: stored, resolved: false };
    jidCache.set(cacheKey, { jid, at: Date.now() });
    return { jid, resolved: true };
  } catch {
    clearTimeout(timer);
    logEvolutionAction("whatsappNumbers", { error: "network_or_timeout" });
    return { jid: stored, resolved: false };
  }
}

const INVALID_RECIPIENT: EvolutionActionResult = {
  success: false,
  error: "Telefone do destinatário inválido",
  code: "INVALID_PHONE",
};

/** Edita o texto de uma mensagem nossa: POST /chat/updateMessage/{instância}. */
export async function editEvolutionMessage(
  instanceName: string | undefined,
  thread: string | undefined,
  externalMessageId: string,
  newText: string,
): Promise<EvolutionActionResult> {
  const target = await resolveChatJid(instanceName, thread);
  if (!target) return INVALID_RECIPIENT;
  const remoteJid = target.jid;
  const number = formatPhoneForEvolution(remoteJid) ?? remoteJid;
  return callEvolution({
    method: "POST",
    path: "/chat/updateMessage",
    instanceName,
    body: { number, key: { remoteJid, fromMe: true, id: externalMessageId }, text: newText },
  });
}

/** Apaga para todos uma mensagem nossa: DELETE /chat/deleteMessageForEveryone/{instância} (corpo plano na v2.3.7). */
export async function deleteEvolutionMessageForEveryone(
  instanceName: string | undefined,
  thread: string | undefined,
  externalMessageId: string,
): Promise<EvolutionActionResult> {
  const target = await resolveChatJid(instanceName, thread);
  if (!target) return INVALID_RECIPIENT;
  const remoteJid = target.jid;
  return callEvolution({
    method: "DELETE",
    path: "/chat/deleteMessageForEveryone",
    instanceName,
    body: { id: externalMessageId, remoteJid, fromMe: true },
  });
}

/** Reage a uma mensagem (emoji vazio remove a reação): POST /message/sendReaction/{instância}. */
export async function sendEvolutionReaction(
  instanceName: string | undefined,
  thread: string | undefined,
  externalMessageId: string,
  fromMe: boolean,
  emoji: string,
): Promise<EvolutionActionResult> {
  const target = await resolveChatJid(instanceName, thread);
  if (!target) return INVALID_RECIPIENT;
  const remoteJid = target.jid;
  return callEvolution({
    method: "POST",
    path: "/message/sendReaction",
    instanceName,
    body: { key: { remoteJid, fromMe, id: externalMessageId }, reaction: emoji },
  });
}

/**
 * Envia áudio de voz (PTT): POST /message/sendWhatsAppAudio/{instância}. A Evolution converte para ogg/opus
 * (`encoding: true`) e a mensagem chega como gravação de voz. `audioUrl` é a URL assinada de vida curta do arquivo.
 */
export async function sendEvolutionVoiceNote(
  instanceName: string | undefined,
  toPhone: string | undefined,
  audioUrl: string,
  quoted?: EvolutionQuoted | null,
): Promise<SendEvolutionTextMessageResult> {
  const number = toPhone ? formatPhoneForEvolution(toPhone) : null;
  if (!number) return { success: false, error: "Telefone do destinatário inválido", code: "INVALID_PHONE" };
  const result = await callEvolution({
    method: "POST",
    path: "/message/sendWhatsAppAudio",
    instanceName,
    timeoutMs: 60000,
    expectsExternalId: true,
    body: { number, audio: audioUrl, encoding: true, ...(quoted ? { quoted: quotedPayload(quoted) } : {}) },
  });
  if (!result.success) return result;
  return { success: true, externalMessageId: result.externalMessageId as string };
}
