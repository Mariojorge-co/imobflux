/** Categorias da consulta de auditoria (prefixo da ação) e seus nomes na tela. */
export const AUDIT_CATEGORIES = [
  { value: "team", label: "Equipe" },
  { value: "conversation", label: "Conversas" },
  { value: "opportunity", label: "Oportunidades" },
  { value: "contact", label: "Contatos" },
  { value: "group", label: "Grupos" },
  { value: "task", label: "Tarefas" },
  { value: "export", label: "Exportações" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "bootstrap", label: "Conta" },
  { value: "quick_reply", label: "Respostas rápidas" },
  { value: "sla", label: "Prazos" },
  { value: "message", label: "Mensagens" },
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number]["value"];

const ACTION_LABELS: Record<string, string> = {
  "bootstrap.completed": "Conta criada",
  "team.invitation_created": "Convite enviado",
  "team.invitation_resent": "Convite reenviado",
  "team.invitation_accepted": "Convite aceito",
  "team.member_deactivated": "Acesso do funcionário desativado",
  "team.member_reactivated": "Funcionário reativado",
  "team.member_removed": "Funcionário removido",
  "sla.conversation_paused": "Prazo da conversa pausado até o cliente falar de novo",
  "sla.conversation_disabled": "Prazo da conversa desativado",
  "sla.conversation_enabled": "Prazo da conversa reativado",
  "sla.limits_changed": "Limites de prazo alterados",
  "message.file_sent": "Arquivo enviado ao cliente",
  "quick_reply.created": "Resposta rápida criada",
  "quick_reply.updated": "Resposta rápida editada",
  "quick_reply.deleted": "Resposta rápida apagada",
  "quick_reply.category_created": "Categoria de respostas rápidas criada",
  "quick_reply.category_updated": "Categoria de respostas rápidas editada",
  "quick_reply.category_deleted": "Categoria de respostas rápidas apagada",
  "quick_reply.examples_added": "Respostas rápidas de exemplo adicionadas",
  "conversation.started": "Conversa iniciada",
  "conversation.created_for_opportunity": "Conversa criada para uma oportunidade",
  "conversation.assigned": "Responsável atribuído à conversa",
  "conversation.unassigned": "Responsável removido da conversa",
  "conversation.archived": "Conversa arquivada",
  "conversation.restored": "Conversa restaurada",
  "group.owner_only_enabled": "Grupo restrito ao proprietário",
  "group.team_visibility_enabled": "Grupo liberado para a equipe",
  "contact.created": "Contato criado",
  "contact.updated": "Contato editado",
  "contact.display_name_updated": "Nome do contato alterado",
  "contact.status_changed": "Situação do contato alterada",
  "contact.archived": "Contato arquivado",
  "contact.restored": "Contato restaurado",
  "contact.owner_only_enabled": "Contato protegido (somente proprietário)",
  "contact.team_visibility_enabled": "Contato liberado para a equipe",
  "contact.qualification_updated": "Qualificação do contato atualizada",
  "opportunity.created": "Oportunidade criada",
  "opportunity.updated": "Oportunidade editada",
  "opportunity.stage_changed": "Oportunidade mudou de etapa",
  "opportunity.reordered": "Oportunidade reordenada no Kanban",
  "opportunity.conversation_linked": "Conversa vinculada à oportunidade",
  "opportunity.qualification_updated": "Qualificação da oportunidade atualizada",
  "opportunity.responsible_cleared": "Oportunidade ficou sem responsável",
  "opportunity.rework_set": "Oportunidade em retrabalho",
  "opportunity.reactivated": "Oportunidade reativada",
  "opportunity.won": "Oportunidade ganha",
  "opportunity.lost": "Oportunidade perdida",
  "opportunity.cancelled": "Oportunidade cancelada",
  "opportunity.archived": "Oportunidade arquivada",
  "task.created": "Tarefa criada",
  "task.updated": "Tarefa editada",
  "task.completed": "Tarefa concluída",
  "task.cancelled": "Tarefa cancelada",
  "task.reassigned": "Responsável da tarefa alterado",
  "export.contacts": "Exportação de contatos",
  "export.opportunities": "Exportação de oportunidades",
  "whatsapp.channel_registered": "Conexão do WhatsApp iniciada",
  "whatsapp.channel_connected": "WhatsApp conectado",
  "whatsapp.ingest_settings_changed": "Filtros de entrada do WhatsApp alterados",
  "whatsapp.channel_disconnected": "WhatsApp desconectado",
  "whatsapp.channel_number_changed": "Número do WhatsApp alterado",
};

const FIELD_LABELS: Record<string, string> = {
  operation_type: "tipo de operação",
  property_type_preference: "tipo de imóvel",
  city_region_preference: "cidade/região",
  max_price_budget: "valor máximo",
  available_down_payment: "entrada",
  timeframe_intent: "prazo",
  notes: "observações",
  family_income: "renda familiar",
  financial_analysis_status: "análise financeira",
  approved_credit_amount: "crédito aprovado",
  docs_status: "documentação",
};

export type AuditEventRow = {
  id: string;
  occurred_at: string;
  action: string;
  target_type: string;
  target_id: string | null;
  result: "success" | "denied" | "failed";
  actor_type: "member" | "system";
  actor_member_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
};

export type AuditEventView = {
  id: string;
  when: string;
  title: string;
  categoryLabel: string;
  actor: string;
  result: AuditEventRow["result"];
  detail: string | null;
  href: string | null;
};

export function categoryOf(action: string): string {
  return action.split(".")[0] ?? "";
}

export function categoryLabel(category: string): string {
  return AUDIT_CATEGORIES.find((item) => item.value === category)?.label ?? "Outros";
}

function memberName(memberId: unknown, names: Map<string, string>): string {
  return typeof memberId === "string" ? (names.get(memberId) ?? "outro membro") : "outro membro";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Detalhe curto e seguro: só mostra campos conhecidos (ids viram nomes; valores digitados nunca existem
 * na auditoria). Evento desconhecido não exibe metadados.
 */
function detailOf(event: AuditEventRow, names: Map<string, string>): string | null {
  const meta = event.metadata ?? {};
  switch (event.action) {
    case "conversation.assigned":
      return `Responsável: ${memberName(meta.member_id, names)}${meta.from_member_id ? ` (no lugar de ${memberName(meta.from_member_id, names)})` : ""}`;
    case "conversation.unassigned":
      return meta.reason === "reassigned"
        ? `${memberName(meta.member_id, names)} passou a conversa para ${memberName(meta.to_member_id, names)}`
        : `Removido: ${memberName(meta.member_id, names)}`;
    case "opportunity.responsible_cleared":
      return `Antes: ${memberName(meta.previous_member_id, names)} (removido da equipe)`;
    case "team.member_removed":
      return [
        `Conversas liberadas: ${count(meta.ended_conversation_assignments)}`,
        `oportunidades: ${count(meta.cleared_opportunities)}`,
        `tarefas: ${count(meta.cleared_tasks)}`,
      ].join(" · ");
    case "opportunity.qualification_updated":
    case "contact.qualification_updated": {
      const fields = Array.isArray(meta.fields)
        ? meta.fields.filter((field): field is string => typeof field === "string").map((field) => FIELD_LABELS[field] ?? field)
        : [];
      return fields.length > 0 ? `Campos: ${fields.join(", ")}` : null;
    }
    case "export.contacts":
    case "export.opportunities":
      return typeof meta.row_count === "number" ? `${meta.row_count} registros` : null;
    default:
      return null;
  }
}

function hrefOf(event: AuditEventRow): string | null {
  if (!event.target_id) return null;
  if (event.target_type === "conversation") return `/conversas/${event.target_id}`;
  if (event.target_type === "opportunity") return `/kanban?opportunityId=${event.target_id}`;
  return null;
}

export function describeAuditEvent(event: AuditEventRow, names: Map<string, string> = new Map()): AuditEventView {
  const baseTitle = ACTION_LABELS[event.action] ?? event.action;
  const title = event.result === "denied" ? `${baseTitle} (negado)` : event.result === "failed" ? `${baseTitle} (falhou)` : baseTitle;
  return {
    id: event.id,
    when: event.occurred_at,
    title,
    categoryLabel: categoryLabel(categoryOf(event.action)),
    actor: event.actor_type === "system" ? "Sistema" : (event.actor_name ?? "Membro removido"),
    result: event.result,
    detail: detailOf(event, names),
    href: hrefOf(event),
  };
}
