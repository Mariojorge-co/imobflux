// Web Push: o que vai dentro do aviso. NUNCA o texto da mensagem: só o nome do contato (ou do grupo) e um texto fixo.

export type PushPayload = {
  kind: "message" | "test";
  title: string;
  body: string;
  /** Caminho a abrir ao tocar no aviso. */
  path: string;
  /** Uma notificação por conversa: a nova substitui a anterior em vez de empilhar. */
  tag: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_LIMIT = 60;

/** Caracteres invisíveis ou de controle (inclui os que invertem o sentido do texto), que não devem aparecer no título do aviso. */
function isInvisible(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Tira caracteres invisíveis e espaços repetidos, limita o tamanho e nunca devolve vazio. */
export function cleanContactName(name: string | null | undefined): string {
  const text = Array.from(name ?? "", (char) => (isInvisible(char.codePointAt(0) ?? 0) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "contato";
  return text.length > NAME_LIMIT ? `${text.slice(0, NAME_LIMIT - 1)}…` : text;
}

export function buildMessagePayload(conversationId: string, contactName: string | null | undefined): PushPayload {
  const valid = UUID.test(conversationId);
  return {
    kind: "message",
    title: `Nova mensagem de ${cleanContactName(contactName)}`,
    body: "Toque para abrir a conversa.",
    path: valid ? `/conversas/${conversationId}` : "/conversas",
    // Mesma etiqueta do aviso local (NewMessageNotifier): aviso local e aviso do servidor se substituem, não empilham.
    tag: valid ? `conversa-${conversationId}` : "imobflux-aviso",
  };
}

export function buildTestPayload(): PushPayload {
  return {
    kind: "test",
    title: "Aviso de teste do ImobFlux",
    body: "Se você está vendo isto, os avisos neste aparelho estão funcionando.",
    path: "/preferencias",
    tag: "imobflux-teste",
  };
}
