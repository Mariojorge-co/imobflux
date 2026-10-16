import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  parseEvolutionWebhookPayload,
  validateWebhookSecret,
} from "@/lib/conversations/webhook";

import { importHistoryBatch } from "@/lib/conversations/history-import";
import { webhookShapeLine } from "@/lib/conversations/webhook-shape";
import { scheduleMediaDownload, storeAttachmentMedia } from "@/lib/conversations/media-download";

// O download da mídia roda depois da resposta (after); dá tempo suficiente para arquivos grandes.
export const maxDuration = 60;

/**
 * Diagnóstico do que a Evolution realmente entrega, SEM conteúdo: só o nome do evento, o tipo do resultado e a FORMA do
 * payload (chaves e tipos, nunca valores). Serve para confirmar como chegam edição, exclusão, reação e resposta citada.
 */
function logShape(body: unknown, kind: string) {
  try {
    const payload = body as { event?: unknown; data?: unknown } | null;
    console.log(webhookShapeLine(String(payload?.event ?? "?"), kind, payload?.data));
  } catch {
    // diagnóstico nunca derruba o webhook
  }
}

export async function POST(request: Request) {
  try {
    // 1. Validar autenticidade do webhook via header X-Evolution-Secret
    const expectedSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    const incomingSecret = request.headers.get("x-evolution-secret");

    if (!validateWebhookSecret(incomingSecret, expectedSecret)) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401 },
      );
    }

    // 2. Parsear payload JSON
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Payload JSON inválido" },
        { status: 400 },
      );
    }

    // 3. Processar regras de validação do payload
    const result = parseEvolutionWebhookPayload(body);

    if (result.status === "malformed") {
      return NextResponse.json(
        { error: result.error },
        { status: 400 },
      );
    }

    if (result.status === "connection") {
      if (!result.state) {
        return NextResponse.json({ status: "ignored", reason: "unhandled_connection_state" }, { status: 200 });
      }
      const { data: syncResult, error: syncError } = await createAdminSupabaseClient().rpc("sync_whatsapp_channel_state", {
        p_instance_name: result.instance,
        p_state: result.state,
      });
      if (syncError) {
        console.error("Erro ao sincronizar o estado da conexão do WhatsApp via RPC:", syncError);
        return NextResponse.json({ error: "Erro interno no processamento do webhook" }, { status: 500 });
      }
      return NextResponse.json(syncResult ?? { status: "success" }, { status: 200 });
    }

    // Só os tipos que interessam ao diagnóstico (edição, exclusão, reação, citação, o que foi ignorado e eventos desconhecidos).
    if (result.status === "edit" || result.status === "revoke" || result.status === "reaction") logShape(body, result.status);
    else if (result.status === "ignored") {
      if (result.reason === "unhandled_event") {
        const unhandled = (body as { event?: unknown } | null)?.event;
        console.log(`[webhook-event] ignorado event=${String(unhandled ?? "?").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40)}`);
      } else logShape(body, `ignored-${result.reason}`);
    } else if (result.status === "valid" && result.quoted) logShape(body, "quoted");

    if (result.status === "history") {
      try {
        const summary = await importHistoryBatch(createAdminSupabaseClient(), result);
        if (summary.disabled) {
          return NextResponse.json({ status: "ignored", reason: "history_disabled", received: result.received }, { status: 200 });
        }
        return NextResponse.json({ status: "history_imported", received: result.received, skipped: result.skipped, ...summary }, { status: 200 });
      } catch (historyError) {
        // 500: a Evolution tenta de novo (a importação é idempotente) e o erro já ficou registrado
        // na conexão para o OWNER ver.
        console.error("Erro ao importar lote de histórico do WhatsApp:", historyError);
        return NextResponse.json({ error: "Erro interno no processamento do webhook" }, { status: 500 });
      }
    }

    // Edição, exclusão e reação feitas pelo cliente ou pelo celular: o banco aplica (idempotente) e ignora o que não conhece.
    // Erro do banco devolve 500 para a Evolution tentar de novo.
    if (result.status === "edit" || result.status === "revoke" || result.status === "reaction") {
      const admin = createAdminSupabaseClient();
      const { data: actionResult, error: actionError } =
        result.status === "edit"
          ? await admin.rpc("ingest_whatsapp_message_edit", {
              p_external_account_id: result.instance,
              p_external_message_id: result.externalMessageId,
              p_new_text: result.newText,
              p_edited_at: result.editedAt ?? undefined,
            })
          : result.status === "revoke"
            ? await admin.rpc("ingest_whatsapp_message_delete", {
                p_external_account_id: result.instance,
                p_external_message_id: result.externalMessageId,
              })
            : await admin.rpc("ingest_whatsapp_reaction", {
                p_external_account_id: result.instance,
                p_target_external_id: result.targetExternalId,
                p_reactor_jid: result.reactorJid,
                p_from_me: result.fromMe,
                p_emoji: result.emoji,
              });
      if (actionError) {
        console.error(`Erro ao aplicar ${result.status} do WhatsApp via RPC (código):`, actionError.code ?? "desconhecido");
        return NextResponse.json({ error: "Erro interno no processamento do webhook" }, { status: 500 });
      }
      const applied = actionResult as { status?: string; reason?: string } | null;
      console.log(`[webhook-event] ${result.status} aplicado status=${applied?.status ?? "?"} reason=${applied?.reason ?? "-"}`);
      return NextResponse.json(actionResult ?? { status: "success" }, { status: 200 });
    }

    if (result.status === "ignored") {
      return NextResponse.json(
        { status: "ignored", reason: result.reason },
        { status: 200 },
      );
    }
    if (result.status !== "valid") {
      return NextResponse.json(
        { error: "Payload inválido" },
        { status: 400 },
      );
    }

    // 4. Se o payload for um texto válido, chamar a RPC ingest_whatsapp_text_message
    const supabase = createAdminSupabaseClient();
    const rpcCall = result.conversationType === "group"
      ? supabase.rpc("ingest_whatsapp_group_text_message", {
          p_external_account_id: result.instance,
          p_external_message_id: result.externalMessageId || "",
          p_group_jid: result.remoteJid,
          p_sender_jid: result.senderJid || "",
          p_from_me: result.fromMe,
          p_group_subject: result.groupSubject || "",
          p_push_name: result.pushName || "",
          p_text_content: result.textContent,
          p_occurred_at: result.occurredAt,
        })
      : supabase.rpc("ingest_whatsapp_text_message", {
          p_external_account_id: result.instance,
          p_external_message_id: result.externalMessageId || "",
          p_remote_jid: result.remoteJid,
          p_from_me: result.fromMe,
          p_push_name: result.pushName || "",
          p_text_content: result.textContent,
          p_occurred_at: result.occurredAt,
        });
    const { data: rpcResult, error: rpcError } = await rpcCall;

    if (rpcError) {
      console.error("Erro ao ingerir mensagem do WhatsApp via RPC:", rpcError);
      return NextResponse.json(
        { error: "Erro interno no processamento do webhook" },
        { status: 500 },
      );
    }

    // Resposta (citação) recebida: liga a mensagem nova à original. É secundário: se falhar, a mensagem já está salva
    // e só fica sem o cartão de citação (não vale pedir reentrega).
    const ingested = rpcResult as { status?: string; message_id?: string } | null;
    if (result.quoted && !(ingested?.message_id && (ingested.status === "success" || ingested.status === "duplicate"))) {
      console.log(`[webhook-event] citação não ligada ingest=${ingested?.status ?? "?"}`);
    }
    if (result.quoted && ingested?.message_id && (ingested.status === "success" || ingested.status === "duplicate")) {
      const { data: quoteResult, error: quoteError } = await supabase.rpc("set_incoming_message_reply", {
        p_message_id: ingested.message_id,
        p_quoted_external_id: result.quoted.externalId,
        p_snapshot: { text: result.quoted.text, has_media: result.quoted.hasMedia },
      });
      if (quoteError) console.error("Erro ao ligar a citação recebida (código):", quoteError.code ?? "desconhecido");
      else console.log(`[webhook-event] citação ligada resolved=${String((quoteResult as { resolved?: boolean } | null)?.resolved ?? "?")} from_me=${result.fromMe}`);
    }

    // Mídia: registra os metadados do anexo na mensagem recém-ingerida (idempotente, então
    // também cobre reentregas). Falha aqui retorna 500 para o provedor poder reenviar.
    if (result.media && ingested?.message_id && (ingested.status === "success" || ingested.status === "duplicate")) {
      const { data: attachResult, error: attachError } = await supabase.rpc("attach_whatsapp_media", {
        p_message_id: ingested.message_id,
        p_media_kind: result.media.kind,
        p_file_name: result.media.fileName ?? "",
        p_mime_type: result.media.mimeType ?? "",
        p_size_bytes: result.media.sizeBytes ?? undefined,
      });
      if (attachError) {
        console.error("Erro ao registrar anexo de mídia do WhatsApp via RPC:", attachError);
        return NextResponse.json(
          { error: "Erro interno no processamento do webhook" },
          { status: 500 },
        );
      }

      // O download do arquivo roda depois da resposta; se falhar, o anexo fica "indisponível"
      // (aviso + nova tentativa na conversa) e a mensagem não é afetada.
      const attachment = attachResult as { attachment_id?: string; attachment_status?: string } | null;
      if (attachment?.attachment_id && attachment.attachment_status !== "available" && result.externalMessageId) {
        const attachmentId = attachment.attachment_id;
        const source = {
          instance: result.instance,
          key: {
            id: result.externalMessageId,
            remoteJid: result.remoteJid,
            fromMe: result.fromMe,
            participant: result.senderJid,
          },
          inlineBase64: result.media.inlineBase64,
        };
        scheduleMediaDownload(() => storeAttachmentMedia(supabase, attachmentId, source));
      }
    }

    return NextResponse.json(rpcResult ?? { status: "success" }, {
      status: 200,
    });
  } catch (error) {
    console.error("Erro não tratado no webhook do WhatsApp:", error);
    return NextResponse.json(
      { error: "Erro interno no processamento do webhook" },
      { status: 500 },
    );
  }
}
