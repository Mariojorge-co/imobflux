export type OpportunityTargetStage = { id: string };

export type OpportunityTargets =
  | { ok: true; stageId: string; contactId: string }
  | { ok: false; error: string };

/**
 * Resolve a etapa inicial e o contato usados ao criar uma oportunidade a partir de uma
 * conversa. Usa somente dados reais do workspace (etapas já ordenadas por posição),
 * nunca identificadores de seed.
 */
export function resolveOpportunityTargets(
  stages: readonly OpportunityTargetStage[] | undefined,
  contactId: string | null | undefined,
): OpportunityTargets {
  if (!contactId) {
    return {
      ok: false,
      error: "Esta conversa ainda não está vinculada a um contato. Cadastre o contato antes de criar a oportunidade.",
    };
  }
  const initialStage = stages?.[0];
  if (!initialStage) {
    return {
      ok: false,
      error: "Não foi possível carregar as etapas do Kanban. Atualize a página e tente novamente.",
    };
  }
  return { ok: true, stageId: initialStage.id, contactId };
}
