/** O que a RPC `queue_outgoing_text_message` devolve sobre a conexão de saída (migration 20260802005100). */
export type QueueInstanceInfo = {
  /** Instância da Evolution por onde a mensagem sai; nulo quando não há conexão ativa. */
  instance_name?: string | null;
  connection_status?: string | null;
};

export type SendInstance =
  | { ok: true; instance: string; source: "connection" | "env_fallback" }
  | { ok: false; code: "WHATSAPP_DISCONNECTED" | "MISSING_INSTANCE" };

type EnvLike = Record<string, string | undefined>;

function fallback(env: EnvLike): SendInstance {
  const name = env.EVOLUTION_INSTANCE_NAME?.trim();
  return name ? { ok: true, instance: name, source: "env_fallback" } : { ok: false, code: "MISSING_INSTANCE" };
}

/**
 * Por qual instância da Evolution a mensagem sai.
 *
 * A decisão é do banco, dentro da função que enfileira a mensagem (ela já checou, com a sessão do usuário, que ele
 * pode ver a conversa, e lê a tabela de conexões, que o servidor não lê direto): a conexão da própria conversa se
 * estiver ativa; senão a conexão ativa do workspace. Aqui só interpretamos o resultado:
 * - nome presente: usa a instância do banco (a variável de ambiente é ignorada);
 * - campo presente e nulo: não há conexão ativa → WHATSAPP_DISCONNECTED, nada é enviado (a reserva NÃO mascara isso);
 * - campo ausente (banco ainda sem a migration): EVOLUTION_INSTANCE_NAME como reserva, como era antes.
 */
export function resolveSendInstance(queue: QueueInstanceInfo | null | undefined, env: EnvLike = process.env): SendInstance {
  if (!queue || !("instance_name" in queue)) return fallback(env);
  const name = typeof queue.instance_name === "string" ? queue.instance_name.trim() : "";
  if (name) return { ok: true, instance: name, source: "connection" };
  return { ok: false, code: "WHATSAPP_DISCONNECTED" };
}
