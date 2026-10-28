// Avisos de mensagem nova: regras puras (testáveis sem navegador) e preferências pessoais.
// A preferência é de cada pessoa neste navegador: a chave leva o id do membro, então duas pessoas no mesmo aparelho não se misturam.

export type NotificationPreferences = {
  /** Toca um som curto quando chega mensagem nova (aba aberta). */
  sound: boolean;
  /** Volume do som, de 0 a 1. */
  volume: number;
  /** Mostra o aviso do sistema quando a aba não está em foco (depende da permissão do navegador). */
  desktop: boolean;
  /** Esconde o nome e o texto no aviso do sistema (aparece só "Nova mensagem"). */
  hidePreview: boolean;
  /** Avisa também as conversas com o prazo desativado (por padrão ficam em silêncio). */
  includeDisabled: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  sound: false,
  volume: 0.6,
  desktop: false,
  hidePreview: false,
  includeDisabled: false,
};

export const NOTIFICATION_PREFS_EVENT = "imobflux:notification-prefs-change";

export function notificationPrefsKey(memberId: string): string {
  return `imobflux:notificacoes:${memberId}`;
}

function clampVolume(value: unknown): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_NOTIFICATION_PREFERENCES.volume;
  return Math.min(1, Math.max(0, number));
}

/** Lê o que estava guardado; qualquer valor estranho volta ao padrão (nunca quebra). */
export function parseNotificationPreferences(raw: string | null | undefined): NotificationPreferences {
  if (!raw) return DEFAULT_NOTIFICATION_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof NotificationPreferences, unknown>> | null;
    if (!value || typeof value !== "object") return DEFAULT_NOTIFICATION_PREFERENCES;
    return {
      sound: value.sound === true,
      volume: clampVolume(value.volume),
      desktop: value.desktop === true,
      hidePreview: value.hidePreview === true,
      includeDisabled: value.includeDisabled === true,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export function readNotificationPreferences(memberId: string): NotificationPreferences {
  try {
    return parseNotificationPreferences(window.localStorage.getItem(notificationPrefsKey(memberId)));
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export function saveNotificationPreferences(memberId: string, prefs: NotificationPreferences): void {
  try {
    window.localStorage.setItem(notificationPrefsKey(memberId), JSON.stringify(prefs));
  } catch {
    // sem armazenamento: a escolha vale só até recarregar
  }
  window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFS_EVENT));
}

/** Linha da tabela `messages` como chega pelo tempo real (só os campos que a decisão usa). */
export type IncomingMessageRow = {
  id?: string | null;
  conversation_id?: string | null;
  direction?: string | null;
  origin?: string | null;
  is_history?: boolean | null;
  hidden_at?: string | null;
  deleted_at?: string | null;
  text_content?: string | null;
};

/** A conversa como o banco a devolve para quem está logado (nula = a pessoa não enxerga). */
export type NotifiableConversation = {
  conversation_id: string;
  conversation_type: string;
  visibility: string;
  operational_status: string;
  archived_at?: string | null;
  sla_mode?: string | null;
  is_self?: boolean | null;
  participant_name?: string | null;
} | null;

/** Por que um aviso NÃO saiu (mostrado no painel de diagnóstico das Preferências; nunca guarda texto de mensagem). */
export type IgnoreReason =
  | "invalid"
  | "sent_by_team"
  | "history"
  | "hidden"
  | "invisible"
  | "lookup_failed"
  | "archived"
  | "sla_disabled"
  | "group_owner_only"
  | "self_chat"
  | "reading";

export const IGNORE_REASON_TEXT: Record<IgnoreReason, string> = {
  invalid: "mensagem sem os dados necessários",
  sent_by_team: "mensagem enviada por você ou pela equipe",
  history: "mensagem antiga (histórico do WhatsApp)",
  hidden: "mensagem apagada ou escondida",
  invisible: "conversa que você não enxerga",
  lookup_failed: "não foi possível consultar a conversa",
  archived: "conversa arquivada",
  sla_disabled: "conversa com o prazo desativado (dá para avisar também, nas opções acima)",
  group_owner_only: "grupo não liberado à equipe",
  self_chat: "conversa do número com ele mesmo",
  reading: "você já estava lendo essa conversa",
};

/** Por que a mensagem não é um fato novo do cliente (eco, histórico, apagada…)? `null` = é novidade. */
export function classifyIncomingMessage(row: IncomingMessageRow | null | undefined): IgnoreReason | null {
  if (!row || !row.conversation_id || !row.id) return "invalid";
  // Mensagem que a própria equipe enviou (CRM ou celular) nunca é "recebida": cobre o eco do envio.
  if (row.direction !== "incoming" || row.origin === "crm") return "sent_by_team";
  if (row.is_history) return "history";
  if (row.hidden_at || row.deleted_at) return "hidden";
  return null;
}

/** A mensagem é um fato novo, recebido do cliente, e não é eco, histórico, apagado nem escondido? */
export function isFreshIncomingMessage(row: IncomingMessageRow | null | undefined): boolean {
  return classifyIncomingMessage(row) === null;
}

/**
 * Por que a conversa não gera aviso? `null` = gera. Só as que a pessoa vê, abertas e (grupo) liberadas à equipe.
 * Prazo "pausado" AVISA: ele só dura "até o cliente falar de novo", que é exatamente o que acabou de acontecer.
 * Prazo "desativado" fica em silêncio, a menos que a pessoa peça para avisar também.
 */
export function classifyConversation(
  conversation: NotifiableConversation,
  options: { includeDisabled?: boolean } = {},
): IgnoreReason | null {
  if (!conversation) return "invisible";
  if (conversation.archived_at || conversation.operational_status === "archived") return "archived";
  if (conversation.is_self) return "self_chat";
  if (conversation.conversation_type === "group" && conversation.visibility === "owner_only") return "group_owner_only";
  if (conversation.sla_mode === "disabled" && !options.includeDisabled) return "sla_disabled";
  return null;
}

export function isNotifiableConversation(conversation: NotifiableConversation, options: { includeDisabled?: boolean } = {}): boolean {
  return classifyConversation(conversation, options) === null;
}

export type AttentionState = {
  /** A aba está visível E com foco. */
  tabFocused: boolean;
  /** A conversa aberta agora, se houver. */
  openConversationId: string | null;
};

/** Quem está olhando para a própria conversa já viu a mensagem: nada de aviso. */
export function isAlreadyBeingRead(conversationId: string, attention: AttentionState): boolean {
  return attention.tabFocused && attention.openConversationId === conversationId;
}

/** Contador no título da aba: "(3) Título". Sem mensagens novas, volta o título limpo. */
export function applyTitleCount(title: string, count: number): string {
  const clean = stripTitleCount(title);
  if (count <= 0) return clean;
  return `(${count > 99 ? "99+" : count}) ${clean}`;
}

export function stripTitleCount(title: string): string {
  return title.replace(/^\((?:\d{1,2}|99\+)\)\s+/, "");
}

export type DesktopNotificationContent = { title: string; body: string };

const PREVIEW_LIMIT = 120;

/** O que o aviso do sistema mostra. Com "esconder prévia" não vaza nem o nome nem o texto. */
export function buildDesktopNotification(
  participantName: string | null | undefined,
  text: string | null | undefined,
  hidePreview: boolean,
): DesktopNotificationContent {
  if (hidePreview) return { title: "ImobFlux", body: "Você recebeu uma nova mensagem." };
  const body = (text ?? "").replace(/\s+/g, " ").trim();
  return {
    title: participantName?.trim() || "Nova mensagem",
    body: body ? (body.length > PREVIEW_LIMIT ? `${body.slice(0, PREVIEW_LIMIT - 1)}…` : body) : "Enviou uma mensagem.",
  };
}
