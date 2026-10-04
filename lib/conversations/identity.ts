export type ConversationIdentityInput = {
  conversationType: string;
  contactDisplayName?: string | null;
  externalDisplayName?: string | null;
  groupSubject?: string | null;
  phoneDisplayValue?: string | null;
  normalizedPhone?: string | null;
};

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function formatNormalizedPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;

  if (national.length === 10) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }

  if (national.length === 11) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }

  return clean(value);
}

/** Resolve a conversation header identity without allowing pushName to replace CRM data. */
export function resolveConversationIdentity(input: ConversationIdentityInput) {
  if (input.conversationType === "group") {
    return clean(input.groupSubject) ?? "Grupo WhatsApp";
  }

  return (
    clean(input.contactDisplayName) ??
    clean(input.externalDisplayName) ??
    clean(input.phoneDisplayValue) ??
    formatNormalizedPhone(input.normalizedPhone)
  );
}
