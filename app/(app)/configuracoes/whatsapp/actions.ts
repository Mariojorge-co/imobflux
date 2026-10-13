"use server";

import { headers } from "next/headers";
import * as dalModule from "@/lib/auth/dal";
import * as serverModule from "@/lib/supabase/server";
import { assertTrustedServerActionOrigin } from "@/lib/auth/security";
import * as evolution from "@/lib/whatsapp/evolution-instance";
import type { EvolutionFailure, EvolutionQr } from "@/lib/whatsapp/evolution-instance";
import { instanceNameForWorkspace, resolveWebhookUrl, type InstanceState } from "@/lib/whatsapp/channel";
import { resolveHistoryImport, type HistoryImportView } from "@/lib/whatsapp/history-status";
import { INGEST_SETTINGS_COLUMNS, parseIngestSettings, pickCurrentConnection, type IngestSettings } from "@/lib/whatsapp/ingest-settings";

export type WhatsappActionErrorCode =
  | "FORBIDDEN"
  | "NOT_CONFIGURED"
  | "WEBHOOK_SECRET_MISSING"
  | "WEBHOOK_UNREACHABLE"
  | "EVOLUTION_UNREACHABLE"
  | "EVOLUTION_REJECTED"
  | "DATABASE";

export type WhatsappActionResult =
  | { ok: true; state: InstanceState; qr: EvolutionQr | null; phone: string | null }
  | { ok: false; code: WhatsappActionErrorCode; error: string };

const ERRORS: Record<WhatsappActionErrorCode, string> = {
  FORBIDDEN: "Somente o proprietário pode conectar ou desconectar o WhatsApp.",
  NOT_CONFIGURED: "A integração com o WhatsApp ainda não foi configurada neste ambiente. Peça ao responsável técnico para definir EVOLUTION_API_URL e EVOLUTION_API_KEY.",
  WEBHOOK_SECRET_MISSING: "Falta configurar o segredo do webhook (EVOLUTION_WEBHOOK_SECRET) no servidor.",
  WEBHOOK_UNREACHABLE: "O endereço do sistema não é acessível pela internet, então o WhatsApp não conseguiria entregar as mensagens. Use o endereço publicado do ImobFlux.",
  EVOLUTION_UNREACHABLE: "Não foi possível falar com o servidor do WhatsApp agora. Tente novamente em instantes.",
  EVOLUTION_REJECTED: "O servidor do WhatsApp recusou a solicitação. Verifique a chave de acesso (EVOLUTION_API_KEY).",
  DATABASE: "Não foi possível registrar a conexão agora. Tente novamente.",
};

const fail = (code: WhatsappActionErrorCode): WhatsappActionResult => ({ ok: false, code, error: ERRORS[code] });

function fromEvolution(code: EvolutionFailure): WhatsappActionResult {
  if (code === "NOT_CONFIGURED") return fail("NOT_CONFIGURED");
  if (code === "UNAUTHORIZED") return fail("EVOLUTION_REJECTED");
  return fail("EVOLUTION_UNREACHABLE");
}

async function ownerInstance(): Promise<{ instance: string } | WhatsappActionResult> {
  try {
    await assertTrustedServerActionOrigin();
  } catch {
    return fail("FORBIDDEN");
  }
  const access = await dalModule.getOptionalActiveAccess();
  if (!access || access.role !== "owner") return fail("FORBIDDEN");
  return { instance: instanceNameForWorkspace(access.workspaceId) };
}

type Supabase = Awaited<ReturnType<typeof serverModule.createServerSupabaseClient>>;

/** Conexão confirmada pelo WhatsApp: busca o número, ativa no banco e devolve o resultado. */
async function finalizeOpen(supabase: Supabase, instance: string): Promise<WhatsappActionResult> {
  const number = await evolution.getInstanceNumber(instance);
  const phone = number.ok ? number.data : null;
  const { data, error } = await supabase.rpc("confirm_whatsapp_channel_state", {
    p_instance_name: instance,
    p_state: "open",
    ...(phone ? { p_phone: phone } : {}),
  });
  if (error) return fail("DATABASE");

  const result = data as { status?: string; reason?: string } | null;
  // Sem o número ainda não é possível ativar: o app continua consultando até ele aparecer.
  if (result?.status === "ignored" && result.reason === "phone_required") {
    return { ok: true, state: "connecting", qr: null, phone: null };
  }
  return { ok: true, state: "open", qr: null, phone };
}

/**
 * Inicia a conexão: registra a conexão do workspace, garante a instância e o webhook na
 * Evolution e devolve o QR code para o proprietário ler no WhatsApp do celular.
 */
export async function startWhatsappConnectionAction(): Promise<WhatsappActionResult> {
  const owner = await ownerInstance();
  if (!("instance" in owner)) return owner;
  const { instance } = owner;

  if (!evolution.isEvolutionConfigured()) return fail("NOT_CONFIGURED");
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!secret) return fail("WEBHOOK_SECRET_MISSING");

  const requestHeaders = await headers();
  const webhook = resolveWebhookUrl({
    host: requestHeaders.get("x-forwarded-host")?.split(",")[0].trim() || requestHeaders.get("host"),
    proto: requestHeaders.get("x-forwarded-proto")?.split(",")[0].trim() || null,
  });
  if (!webhook.ok) return fail("WEBHOOK_UNREACHABLE");

  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data: registered, error } = await supabase.rpc("register_whatsapp_channel", { p_instance_name: instance });
    if (error) return fail(error.code === "42501" ? "FORBIDDEN" : "DATABASE");
    // Janela de histórico 0: a Evolution nem assina o evento de histórico para esta conexão.
    const includeHistory = (registered as { history_window_days?: number } | null)?.history_window_days !== 0;

    const created = await evolution.createInstance(instance);
    if (!created.ok) return fromEvolution(created.code);

    const hook = await evolution.setInstanceWebhook(instance, { url: webhook.url, secret, includeHistory });
    if (!hook.ok) return fromEvolution(hook.code);

    const state = await evolution.getInstanceState(instance);
    if (!state.ok) return fromEvolution(state.code);
    if (state.data === "open") return await finalizeOpen(supabase, instance);

    let qr = created.data.qr;
    if (!qr || !created.data.created) {
      const connected = await evolution.connectInstance(instance);
      if (!connected.ok) return fromEvolution(connected.code);
      qr = connected.data.qr ?? qr;
    }
    return { ok: true, state: "connecting", qr, phone: null };
  } catch (error) {
    console.error("Erro em startWhatsappConnectionAction:", error);
    return fail("EVOLUTION_UNREACHABLE");
  }
}

/**
 * Consulta o estado real da conexão (chamada repetidamente pela tela). Com `renewQr`, também
 * pede um QR novo, já que o código do WhatsApp expira em poucos segundos.
 */
export async function refreshWhatsappConnectionAction(renewQr = false): Promise<WhatsappActionResult> {
  const owner = await ownerInstance();
  if (!("instance" in owner)) return owner;
  const { instance } = owner;

  if (!evolution.isEvolutionConfigured()) return fail("NOT_CONFIGURED");

  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const state = await evolution.getInstanceState(instance);

    // Instância inexistente na Evolution equivale a "não conectado".
    if (!state.ok && state.code !== "NOT_FOUND") return fromEvolution(state.code);
    const current: InstanceState = state.ok ? state.data : "close";

    if (current === "open") return await finalizeOpen(supabase, instance);

    if (current === "close") {
      // Se o banco ainda marca como ativa (ex.: desconectada pelo celular), alinha o estado.
      const { error } = await supabase.rpc("confirm_whatsapp_channel_state", { p_instance_name: instance, p_state: "close" });
      if (error && error.code !== "P0002") return fail("DATABASE");
      return { ok: true, state: "close", qr: null, phone: null };
    }

    if (renewQr) {
      const connected = await evolution.connectInstance(instance);
      if (!connected.ok) return fromEvolution(connected.code);
      return { ok: true, state: "connecting", qr: connected.data.qr, phone: null };
    }
    return { ok: true, state: "connecting", qr: null, phone: null };
  } catch (error) {
    console.error("Erro em refreshWhatsappConnectionAction:", error);
    return fail("EVOLUTION_UNREACHABLE");
  }
}

/** Encerra a sessão do WhatsApp (o aparelho deixa de estar conectado) e para de receber mensagens. */
export async function disconnectWhatsappAction(): Promise<WhatsappActionResult> {
  const owner = await ownerInstance();
  if (!("instance" in owner)) return owner;
  const { instance } = owner;

  if (!evolution.isEvolutionConfigured()) return fail("NOT_CONFIGURED");

  try {
    const loggedOut = await evolution.logoutInstance(instance);
    if (!loggedOut.ok && loggedOut.code !== "NOT_FOUND") return fromEvolution(loggedOut.code);

    const supabase = await serverModule.createServerSupabaseClient();
    const { error } = await supabase.rpc("confirm_whatsapp_channel_state", { p_instance_name: instance, p_state: "close" });
    if (error && error.code !== "P0002") return fail("DATABASE");
    return { ok: true, state: "close", qr: null, phone: null };
  } catch (error) {
    console.error("Erro em disconnectWhatsappAction:", error);
    return fail("EVOLUTION_UNREACHABLE");
  }
}

export type HistoryImportActionResult =
  | { ok: true; view: HistoryImportView; startedAt: string | null }
  | { ok: false };

/** Estado da importação de histórico da conexão ativa (somente OWNER; leitura pela RLS). */
export async function getHistoryImportStatusAction(): Promise<HistoryImportActionResult> {
  const access = await dalModule.getOptionalActiveAccess();
  if (!access || access.role !== "owner") return { ok: false };
  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const { data, error } = await supabase
      .from("channel_connections")
      .select("history_import_status, history_import_started_at, history_import_finished_at, history_imported_count, history_import_error")
      .eq("provider", "whatsapp")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return { ok: false };
    const row = data?.[0];
    if (!row) return { ok: true, view: { state: "none" }, startedAt: null };
    return {
      ok: true,
      startedAt: row.history_import_started_at,
      view: resolveHistoryImport({
        status: row.history_import_status,
        startedAt: row.history_import_started_at,
        finishedAt: row.history_import_finished_at,
        importedCount: row.history_imported_count,
        error: row.history_import_error,
      }),
    };
  } catch (error) {
    console.error("Erro em getHistoryImportStatusAction:", error);
    return { ok: false };
  }
}

export type IngestSettingsInput = { ingestGroups?: boolean; onlyKnownContacts?: boolean; historyWindowDays?: number };

export type IngestSettingsActionResult =
  | { ok: true; connectionStatus: string | null; settings: IngestSettings }
  | { ok: false; error: string };

const INGEST_ERRORS = {
  INVALID: "Valor inválido para esta configuração.",
  LOCKED: "O histórico só pode ser escolhido antes de conectar o número. Desconecte e conecte de novo para mudar.",
  DATABASE: "Não foi possível salvar agora. Tente novamente.",
} as const;

/**
 * OWNER: liga/desliga as chaves de entrada do WhatsApp (grupos, modo "só cadastrados", janela de
 * histórico). Sem conexão registrada ainda, registra uma (só no banco) para guardar a escolha antes do QR code.
 * A alteração é auditada pelo banco.
 */
export async function saveWhatsappIngestSettingsAction(input: IngestSettingsInput): Promise<IngestSettingsActionResult> {
  const owner = await ownerInstance();
  if (!("instance" in owner)) return { ok: false, error: owner.ok ? ERRORS.FORBIDDEN : owner.error };

  const { ingestGroups, onlyKnownContacts, historyWindowDays } = input ?? {};
  const validBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
  if (
    !validBoolean(ingestGroups)
    || !validBoolean(onlyKnownContacts)
    || (historyWindowDays !== undefined && (!Number.isInteger(historyWindowDays) || historyWindowDays < 0 || historyWindowDays > 15))
  ) {
    return { ok: false, error: INGEST_ERRORS.INVALID };
  }

  try {
    const supabase = await serverModule.createServerSupabaseClient();
    const args = {
      ...(ingestGroups === undefined ? {} : { p_ingest_groups: ingestGroups }),
      ...(onlyKnownContacts === undefined ? {} : { p_only_known_contacts: onlyKnownContacts }),
      ...(historyWindowDays === undefined ? {} : { p_history_window_days: historyWindowDays }),
    };

    let { error } = await supabase.rpc("update_whatsapp_ingest_settings", args);
    if (error?.code === "P0002") {
      // Ainda não há conexão: registra (somente no banco, sem falar com a Evolution) e tenta de novo.
      const registered = await supabase.rpc("register_whatsapp_channel", { p_instance_name: owner.instance });
      if (registered.error) return { ok: false, error: registered.error.code === "42501" ? ERRORS.FORBIDDEN : INGEST_ERRORS.DATABASE };
      ({ error } = await supabase.rpc("update_whatsapp_ingest_settings", args));
    }
    if (error) {
      if (error.code === "42501") return { ok: false, error: ERRORS.FORBIDDEN };
      if (error.code === "55000") return { ok: false, error: INGEST_ERRORS.LOCKED };
      if (error.code === "22023") return { ok: false, error: INGEST_ERRORS.INVALID };
      return { ok: false, error: INGEST_ERRORS.DATABASE };
    }

    const { data, error: readError } = await supabase.from("channel_connections").select(INGEST_SETTINGS_COLUMNS).eq("provider", "whatsapp");
    if (readError) return { ok: false, error: INGEST_ERRORS.DATABASE };
    const current = pickCurrentConnection(data);
    return { ok: true, connectionStatus: current?.status ?? null, settings: parseIngestSettings(current) };
  } catch (error) {
    console.error("Erro em saveWhatsappIngestSettingsAction:", error);
    return { ok: false, error: INGEST_ERRORS.DATABASE };
  }
}
