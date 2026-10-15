// Variáveis das respostas rápidas: resolvidas ao INSERIR na caixa (nunca no banco) e conferidas ao ENVIAR.

export type QuickReplyVariable = { key: string; token: string; label: string; example: string };

export const QUICK_REPLY_VARIABLES: readonly QuickReplyVariable[] = [
  { key: "nome", token: "{{nome}}", label: "Primeiro nome do contato", example: "Maria" },
  { key: "nome_completo", token: "{{nome_completo}}", label: "Nome completo do contato", example: "Maria Souza" },
  { key: "meu_nome", token: "{{meu_nome}}", label: "Seu nome (quem atende)", example: "Carlos" },
  { key: "empresa", token: "{{empresa}}", label: "Nome da imobiliária", example: "Imobiliária Farol" },
];

export type VariableContext = {
  /** Nome do contato como aparece na conversa (pode ser vazio ou só um telefone). */
  contactName?: string | null;
  /** Nome de quem atende. */
  memberName?: string | null;
  /** Nome do workspace. */
  workspaceName?: string | null;
};

// {{ chave }} com espaços opcionais; a chave não contém chaves.
const TOKEN_PATTERN = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/** Nome vazio ou que é só um telefone não serve como nome do contato. */
export function usableContactName(name: string | null | undefined): string | null {
  const value = clean(name);
  if (!value) return null;
  if (!/\p{L}/u.test(value)) return null;
  return value;
}

export function firstName(fullName: string): string {
  return fullName.split(" ")[0] ?? fullName;
}

function valueFor(key: string, context: VariableContext): string | null {
  const contact = usableContactName(context.contactName);
  switch (key) {
    case "nome":
      return contact ? firstName(contact) : null;
    case "nome_completo":
      return contact;
    case "meu_nome":
      return clean(context.memberName) || null;
    case "empresa":
      return clean(context.workspaceName) || null;
    default:
      return null;
  }
}

/**
 * Troca as variáveis conhecidas pelo valor. O que não puder ser resolvido (variável desconhecida como {{imovel}}, ou
 * sem dado para preencher) permanece literal, igual ao digitado. O restante do texto não é tocado.
 */
export function resolveVariables(text: string, context: VariableContext): string {
  return text.replace(TOKEN_PATTERN, (token, rawKey: string) => {
    const value = valueFor(rawKey.trim().toLowerCase(), context);
    return value ?? token;
  });
}

/** Campos `{{...}}` ainda presentes (sem repetir), na ordem em que aparecem. */
export function findUnresolvedVariables(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/** Quebra o texto em trechos comuns e variáveis, para destacar as variáveis na tela. */
export function splitVariableSegments(text: string): Array<{ text: string; variable: boolean }> {
  const segments: Array<{ text: string; variable: boolean }> = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: text.slice(last, index), variable: false });
    segments.push({ text: match[0], variable: true });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), variable: false });
  return segments;
}

/** Contexto de exemplo para a pré-visualização na tela de gestão. */
export const PREVIEW_CONTEXT: VariableContext = {
  contactName: "Maria Souza",
  memberName: "Carlos",
  workspaceName: "Imobiliária Farol",
};

export function unresolvedWarning(tokens: string[]): string {
  return `Há campos não preenchidos (${tokens.join(", ")}). Enviar mesmo assim?`;
}
