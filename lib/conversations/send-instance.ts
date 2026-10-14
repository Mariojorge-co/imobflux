import type { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Conexão de WhatsApp como o envio precisa enxergá-la (só os campos necessários). */
export type SendConnectionRow = {
  id: string;
  workspace_id: string;
  status: string;
  external_account_id: string;
};

type LookupResult = { data: SendConnectionRow | null; error: unknown };

/** Leitura mínima das conexões (facilita testar com um falso). */
export interface ConnectionLookup {
  byId(connectionId: string): Promise<LookupResult>;
  activeForWorkspace(workspaceId: string): Promise<LookupResult>;
}

export type SendInstance =
  | { ok: true; instance: string; source: "connection" | "env_fallback" }
  | { ok: false; code: "WHATSAPP_DISCONNECTED" | "MISSING_INSTANCE" };

type EnvLike = Record<string, string | undefined>;

const COLUMNS = "id, workspace_id, status, external_account_id";

/**
 * Leitura com o cliente administrativo. O id da conexão NUNCA vem do navegador: vem da RPC de enfileirar
 * (que já verificou, com a sessão do usuário, que ele pode ver a conversa). O cliente administrativo é
 * necessário porque a tabela de conexões só é legível pelo OWNER, e um ATTENDANT também envia mensagens.
 * Só estes quatro campos são lidos; nenhum segredo está nessa tabela.
 */
export function connectionLookupFromAdmin(admin: Pick<ReturnType<typeof createAdminSupabaseClient>, "from">): ConnectionLookup {
  return {
    async byId(connectionId) {
      const { data, error } = await admin
        .from("channel_connections")
        .select(COLUMNS)
        .eq("id", connectionId)
        .eq("provider", "whatsapp")
        .maybeSingle();
      return { data: (data as SendConnectionRow | null) ?? null, error };
    },
    async activeForWorkspace(workspaceId) {
      const { data, error } = await admin
        .from("channel_connections")
        .select(COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("provider", "whatsapp")
        .eq("status", "active")
        .maybeSingle();
      return { data: (data as SendConnectionRow | null) ?? null, error };
    },
  };
}

function fallback(env: EnvLike): SendInstance {
  const name = env.EVOLUTION_INSTANCE_NAME?.trim();
  return name ? { ok: true, instance: name, source: "env_fallback" } : { ok: false, code: "MISSING_INSTANCE" };
}

/**
 * Descobre por qual instância da Evolution a mensagem sai.
 * 1. A conexão da própria conversa, se estiver ativa;
 * 2. senão, a conexão ativa do workspace (a conversa pode ter nascido numa conexão que foi substituída);
 * 3. sem conexão ativa (inexistente, desconectada, em configuração): WHATSAPP_DISCONNECTED, nada é enviado;
 * 4. EVOLUTION_INSTANCE_NAME é só reserva para quando o banco não pôde ser consultado.
 */
export async function resolveSendInstance(
  lookup: ConnectionLookup,
  connectionId: string | null | undefined,
  env: EnvLike = process.env,
): Promise<SendInstance> {
  if (!connectionId) return fallback(env);

  let own: LookupResult;
  try {
    own = await lookup.byId(connectionId);
  } catch {
    return fallback(env);
  }
  if (own.error) return fallback(env);
  if (!own.data) return { ok: false, code: "WHATSAPP_DISCONNECTED" };
  if (own.data.status === "active" && own.data.external_account_id.trim()) {
    return { ok: true, instance: own.data.external_account_id.trim(), source: "connection" };
  }

  let active: LookupResult;
  try {
    active = await lookup.activeForWorkspace(own.data.workspace_id);
  } catch {
    return fallback(env);
  }
  if (active.error) return fallback(env);
  if (active.data && active.data.external_account_id.trim()) {
    return { ok: true, instance: active.data.external_account_id.trim(), source: "connection" };
  }
  return { ok: false, code: "WHATSAPP_DISCONNECTED" };
}
