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
    if (!response.ok) {
      return { success: false, error: `Evolution API retornou erro HTTP ${response.status}`, code: `HTTP_${response.status}` };
    }
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const externalMessageId = externalIdFrom(data);
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
  const remoteJid = remoteJidOf(thread);
  if (!remoteJid) return INVALID_RECIPIENT;
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
  const remoteJid = remoteJidOf(thread);
  if (!remoteJid) return INVALID_RECIPIENT;
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
  const remoteJid = remoteJidOf(thread);
  if (!remoteJid) return INVALID_RECIPIENT;
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
