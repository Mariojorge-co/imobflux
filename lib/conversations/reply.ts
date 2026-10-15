import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvolutionQuoted } from "@/lib/supabase/gateway";
import type { Database } from "@/types/database";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidReplyId = (value: unknown): value is string => typeof value === "string" && UUID_REGEX.test(value);

/**
 * Liga a mensagem recém-enfileirada à mensagem respondida (o banco confere que as duas são da mesma conversa, que a
 * pessoa é a autora e que a original não foi apagada/escondida) e devolve o que a Evolution precisa para citar.
 * Se algo falhar, a mensagem segue SEM citação (o texto é mais importante que a citação): nunca lança.
 */
export async function attachReply(
  supabase: SupabaseClient<Database>,
  newMessageId: string,
  replyToMessageId: string | null | undefined,
  thread: string | undefined,
): Promise<EvolutionQuoted | null> {
  if (!isValidReplyId(replyToMessageId)) return null;
  const { error } = await supabase.rpc("set_message_reply", {
    p_message_id: newMessageId,
    p_reply_to_message_id: replyToMessageId,
  });
  if (error) {
    console.error("Erro ao ligar a resposta à mensagem citada (código):", error.code ?? "desconhecido");
    return null;
  }
  const remoteJid = thread?.trim();
  if (!remoteJid || !remoteJid.includes("@")) return null;
  const { data } = await supabase
    .from("messages")
    .select("external_message_id, direction, text_content")
    .eq("id", replyToMessageId)
    .maybeSingle();
  if (!data?.external_message_id) return null;
  return {
    externalMessageId: data.external_message_id,
    remoteJid,
    fromMe: data.direction === "outgoing",
    text: data.text_content ?? "",
  };
}
