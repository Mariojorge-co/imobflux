import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  parseEvolutionWebhookPayload,
  validateWebhookSecret,
} from "@/lib/conversations/webhook";

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
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "ingest_whatsapp_text_message",
      {
        p_external_account_id: result.instance,
        p_external_message_id: result.externalMessageId || "",
        p_remote_jid: result.remoteJid,
        p_from_me: result.fromMe,
        p_push_name: result.pushName || "",
        p_text_content: result.textContent,
        p_occurred_at: result.occurredAt,
      },
    );

    if (rpcError) {
      console.error("Erro ao ingerir mensagem do WhatsApp via RPC:", rpcError);
      return NextResponse.json(
        { error: "Erro interno no processamento do webhook" },
        { status: 500 },
      );
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
