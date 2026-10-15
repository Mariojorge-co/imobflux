import type { APIRequestContext } from "@playwright/test";
import { queryLocalSql } from "./local-test-state";

// Simula a Evolution chamando o webhook do app (cabeçalho x-evolution-secret) em testes de navegador.

export function activeInstance(): string {
  return queryLocalSql("select external_account_id from public.channel_connections where status = 'active' limit 1;");
}

export async function postWebhook(request: APIRequestContext, payload: Record<string, unknown>) {
  return request.post("/api/webhooks/whatsapp", {
    headers: { "x-evolution-secret": process.env.EVOLUTION_WEBHOOK_SECRET ?? "" },
    data: payload,
  });
}

export type WebhookTextInput = {
  jid: string;
  text: string;
  fromMe?: boolean;
  id?: string;
  pushName?: string;
  participant?: string;
  subject?: string;
};

export function textPayload(input: WebhookTextInput): Record<string, unknown> {
  return {
    event: "messages.upsert",
    instance: activeInstance(),
    data: {
      key: { remoteJid: input.jid, fromMe: input.fromMe ?? false, id: input.id ?? `WH-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, ...(input.participant ? { participant: input.participant } : {}) },
      pushName: input.pushName ?? "Cliente Teste",
      ...(input.subject ? { subject: input.subject } : {}),
      message: { conversation: input.text },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
}

/** Recebe um texto pelo webhook e devolve o id da conversa criada/usada. */
export async function ingestText(request: APIRequestContext, input: WebhookTextInput): Promise<string> {
  const response = await postWebhook(request, textPayload(input));
  if (!response.ok()) throw new Error(`webhook recusou: ${response.status()}`);
  const id = queryLocalSql(`select id from public.conversations where external_thread_id = '${input.jid}' order by created_at desc limit 1;`);
  if (!id) throw new Error("conversa não criada pelo webhook");
  return id;
}
