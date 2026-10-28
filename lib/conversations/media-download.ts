import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { MAX_MEDIA_BYTES, safeContentType } from "@/lib/conversations/media-types";

type AdminClient = SupabaseClient<Database>;

/** Identifica a mensagem na Evolution para pedir o arquivo. */
export type EvolutionMediaKey = {
  id: string;
  remoteJid?: string | null;
  fromMe?: boolean;
  participant?: string | null;
};

export type MediaSource = {
  instance: string;
  key: EvolutionMediaKey;
  /** Quando o webhook da Evolution já traz o arquivo em base64 (webhook_base64). */
  inlineBase64?: string | null;
};

export type MediaFailureCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "TOO_LARGE"
  | "STORAGE_ERROR"
  | "NOT_FOUND";

export type FetchedMedia =
  | { ok: true; buffer: Buffer; mimeType: string | null }
  | { ok: false; code: MediaFailureCode };

export type StoreMediaResult =
  | { status: "available" }
  | { status: "failed"; code: MediaFailureCode };

/** Decodifica base64 (aceita prefixo data:…;base64,) respeitando o limite de tamanho. */
export function decodeBase64Media(input: unknown, maxBytes: number = MAX_MEDIA_BYTES): { buffer: Buffer; mimeType: string | null } | "TOO_LARGE" | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  let mimeType: string | null = null;
  const dataUrl = /^data:([^;,]+)?(?:;[^,]*)?,/i.exec(value);
  if (dataUrl) {
    mimeType = dataUrl[1] ?? null;
    value = value.slice(dataUrl[0].length);
  }
  value = value.replace(/\s+/g, "");
  if (!value || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  if (Math.floor((value.length * 3) / 4) > maxBytes) return "TOO_LARGE";
  const buffer = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (buffer.length === 0) return null;
  if (buffer.length > maxBytes) return "TOO_LARGE";
  return { buffer, mimeType };
}

type EvolutionEnv = Record<string, string | undefined>;

/**
 * Pede o arquivo à Evolution API v2 (POST /chat/getBase64FromMediaMessage/{instance}).
 * Nunca lança: qualquer falha vira um código.
 */
export async function fetchEvolutionMedia(
  source: MediaSource,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: EvolutionEnv } = {},
): Promise<FetchedMedia> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (source.inlineBase64) {
    const decoded = decodeBase64Media(source.inlineBase64);
    if (decoded === "TOO_LARGE") return { ok: false, code: "TOO_LARGE" };
    if (decoded) return { ok: true, buffer: decoded.buffer, mimeType: decoded.mimeType };
    // base64 inline inválido: tenta buscar na Evolution.
  }

  const apiUrl = env.EVOLUTION_API_URL;
  const apiKey = env.EVOLUTION_API_KEY;
  if (!apiUrl || !apiKey || !source.instance) return { ok: false, code: "NOT_CONFIGURED" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await fetchImpl(
      `${apiUrl.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(source.instance)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({
          message: {
            key: {
              id: source.key.id,
              ...(source.key.remoteJid ? { remoteJid: source.key.remoteJid } : {}),
              ...(typeof source.key.fromMe === "boolean" ? { fromMe: source.key.fromMe } : {}),
              ...(source.key.participant ? { participant: source.key.participant } : {}),
            },
          },
          convertToMp4: false,
        }),
        signal: controller.signal,
      },
    );
    if (response.status === 404) return { ok: false, code: "NOT_FOUND" };
    if (response.status === 400) {
      // A Evolution v2.3.7 responde 400 "Message not found" quando já não tem a mensagem.
      const text = await response.text().catch(() => "");
      return { ok: false, code: /not found/i.test(text) ? "NOT_FOUND" : "HTTP_ERROR" };
    }
    if (!response.ok) return { ok: false, code: "HTTP_ERROR" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: "INVALID_RESPONSE" };
    }
    const payload = body as { base64?: unknown; mimetype?: unknown; mimeType?: unknown } | null;
    const decoded = decodeBase64Media(payload?.base64);
    if (decoded === "TOO_LARGE") return { ok: false, code: "TOO_LARGE" };
    if (!decoded) return { ok: false, code: "INVALID_RESPONSE" };
    const declared = typeof payload?.mimetype === "string" ? payload.mimetype : typeof payload?.mimeType === "string" ? payload.mimeType : null;
    return { ok: true, buffer: decoded.buffer, mimeType: declared ?? decoded.mimeType };
  } catch (error) {
    return { ok: false, code: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Baixa o arquivo da Evolution, guarda no bucket privado e marca o anexo como disponível.
 * Qualquer falha deixa o anexo 'unavailable' (aviso + nova tentativa); nunca lança.
 */
export async function storeAttachmentMedia(
  admin: AdminClient,
  attachmentId: string,
  source: MediaSource,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: EvolutionEnv } = {},
): Promise<StoreMediaResult> {
  const fail = async (code: MediaFailureCode): Promise<StoreMediaResult> => {
    try {
      await admin.rpc("mark_attachment_download_state", { p_attachment_id: attachmentId, p_state: "unavailable" });
    } catch {
      // melhor esforço: o estado 'pending' antigo vira "nova tentativa" na tela depois de 5 min
    }
    console.warn("[whatsapp-media] download não concluído", { attachmentId, code });
    return { status: "failed", code };
  };

  try {
    const context = await getAttachmentContext(admin, attachmentId);
    if (!context) return await fail("NOT_FOUND");
    if (context.status === "available") return { status: "available" };
    const attachment = { storage_bucket: context.storage_bucket, storage_key: context.storage_key, mime_type: context.mime_type };

    await admin.rpc("mark_attachment_download_state", { p_attachment_id: attachmentId, p_state: "pending" });

    const media = await fetchEvolutionMedia(source, options);
    if (!media.ok) return await fail(media.code);

    const contentType = safeContentType(media.mimeType ?? attachment.mime_type);
    const { error: uploadError } = await admin.storage
      .from(attachment.storage_bucket)
      .upload(attachment.storage_key, media.buffer, { contentType, upsert: true });
    if (uploadError) return await fail("STORAGE_ERROR");

    const { error: markError } = await admin.rpc("mark_attachment_available", {
      p_attachment_id: attachmentId,
      p_size_bytes: media.buffer.length,
      p_mime_type: media.mimeType ?? attachment.mime_type,
      p_sha256: createHash("sha256").update(media.buffer).digest("hex"),
    });
    if (markError) return await fail("STORAGE_ERROR");
    return { status: "available" };
  } catch {
    return await fail("NETWORK_ERROR");
  }
}

/** Falhas que podem passar sozinhas (rede, tempo, Evolution/Storage fora do ar). TOO_LARGE, NOT_FOUND etc. são finais. */
const TRANSIENT_FAILURES: ReadonlySet<MediaFailureCode> = new Set(["TIMEOUT", "NETWORK_ERROR", "HTTP_ERROR", "STORAGE_ERROR"]);

/** Tempo para a Evolution entregar o arquivo: 20 s + 1 s por MB (o base64 de um vídeo grande demora), no máximo 50 s. */
export function downloadTimeoutMs(sizeBytes?: number | null): number {
  const megabytes = typeof sizeBytes === "number" && sizeBytes > 0 ? Math.ceil(sizeBytes / (1024 * 1024)) : 0;
  return Math.min(50_000, 20_000 + megabytes * 1000);
}

/**
 * Download automático (webhook): tenta de novo só nas falhas passageiras, com espera crescente e dentro de um
 * orçamento de tempo (a rota roda no máximo 60 s). Acabadas as tentativas, o anexo fica "indisponível" de vez,
 * com o botão manual "Tentar de novo" — nunca um laço infinito.
 */
export async function storeAttachmentMediaWithRetry(
  admin: AdminClient,
  attachmentId: string,
  source: MediaSource,
  options: {
    fetchImpl?: typeof fetch;
    env?: EvolutionEnv;
    sizeBytes?: number | null;
    backoffMs?: number[];
    budgetMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<StoreMediaResult> {
  const backoff = options.backoffMs ?? [2_000, 6_000];
  const budget = options.budgetMs ?? 52_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = downloadTimeoutMs(options.sizeBytes);
  const startedAt = Date.now();
  let result = await storeAttachmentMedia(admin, attachmentId, source, { fetchImpl: options.fetchImpl, env: options.env, timeoutMs });
  for (const wait of backoff) {
    if (result.status === "available" || !TRANSIENT_FAILURES.has(result.code)) break;
    if (Date.now() - startedAt + wait + 5_000 > budget) break;
    await sleep(wait);
    result = await storeAttachmentMedia(admin, attachmentId, source, { fetchImpl: options.fetchImpl, env: options.env, timeoutMs });
  }
  return result;
}

type AttachmentContext = {
  attachment_id: string;
  storage_bucket: string;
  storage_key: string;
  status: string;
  mime_type: string;
  instance: string | null;
  external_message_id: string | null;
  from_me: boolean;
  remote_jid: string | null;
  conversation_type: string;
  participant_phone: string | null;
};

/**
 * Lê (via RPC; a service_role não tem SELECT direto nas tabelas) onde o arquivo é guardado e
 * como pedi-lo ao provedor. Devolve null se o anexo não existir ou a leitura falhar.
 */
export async function getAttachmentContext(admin: AdminClient, attachmentId: string): Promise<AttachmentContext | null> {
  const { data, error } = await admin.rpc("get_attachment_download_context", { p_attachment_id: attachmentId });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  const context = data as Partial<AttachmentContext>;
  if (!context.attachment_id || !context.storage_bucket || !context.storage_key) return null;
  return context as AttachmentContext;
}

/**
 * Reconstrói a origem do arquivo a partir do banco (para "tentar novamente"): instância da
 * conexão, id externo da mensagem e a conversa.
 */
export async function loadMediaSource(admin: AdminClient, attachmentId: string): Promise<MediaSource | null> {
  const context = await getAttachmentContext(admin, attachmentId);
  if (!context?.external_message_id || !context.instance) return null;
  return {
    instance: context.instance,
    key: {
      id: context.external_message_id,
      remoteJid: context.remote_jid,
      fromMe: context.from_me,
      participant: context.participant_phone ? `${context.participant_phone.replace(/\D/g, "")}@s.whatsapp.net` : null,
    },
  };
}
/**
 * Agenda o trabalho para depois da resposta (Next `after` → waitUntil na Vercel). Fora de um
 * contexto de requisição (testes, scripts) executa em segundo plano sem bloquear.
 */
export function scheduleMediaDownload(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => undefined);
  }
}
