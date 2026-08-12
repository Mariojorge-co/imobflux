/**
 * Formata um valor monetário de forma segura contra NaN, null e undefined.
 */
export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Não informado";

  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (Number.isNaN(num)) return "Não informado";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

/**
 * Traduz valores técnicos de enums do banco de dados para rótulos legíveis em Português (PT-BR).
 */
export function formatEnumLabel(value: string | null | undefined): string {
  if (!value) return "Não informado";

  const map: Record<string, string> = {
    // Análise financeira
    not_analyzed: "Não analisado",
    in_analysis: "Em análise",
    approved: "Aprovado",
    conditioned: "Condicionado",
    rejected: "Reprovado",

    // Documentação
    not_sent: "Não enviada",
    pending: "Pendente",
    under_review: "Em análise",
    complete: "Completa",

    // Status de oportunidade
    open: "Em aberto",
    rework: "Reavaliação",
    won: "Ganho",
    lost: "Perdido",
    cancelled: "Cancelado",

    // Classificação de contato
    person: "Pessoa",
    lead: "Lead",
    client: "Cliente",

    // Operação
    buy: "Compra",
    rent: "Aluguel",

    // Cadastro
    provisional: "Contato não salvo",
    confirmed: "Confirmado",
  };

  return map[value] || value;
}
