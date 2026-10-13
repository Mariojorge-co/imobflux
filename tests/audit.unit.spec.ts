import { expect, test } from "@playwright/test";
import { AUDIT_CATEGORIES, categoryOf, describeAuditEvent, type AuditEventRow } from "../lib/audit/labels";
import { auditQueryString, dayAfterIso, dayStartIso, parseAuditFilters } from "../lib/audit/query";

const ID = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";
const BRUNO = "33333333-3333-4333-8333-333333333333";

function event(action: string, overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: ID, occurred_at: "2026-10-12T15:30:00.000Z", action, target_type: "conversation", target_id: ID,
    result: "success", actor_type: "member", actor_member_id: ANA, actor_name: "Dono", metadata: {}, ...overrides,
  };
}

test.describe("Auditoria: rótulos e detalhes", () => {
  test("ações conhecidas ganham texto em português; desconhecidas mostram a ação crua, sem metadados", () => {
    expect(describeAuditEvent(event("team.member_removed")).title).toBe("Funcionário removido");
    const unknown = describeAuditEvent(event("coisa.nova", { metadata: { segredo: "x" } }));
    expect(unknown.title).toBe("coisa.nova");
    expect(unknown.detail).toBeNull();
    expect(unknown.categoryLabel).toBe("Outros");
  });

  test("toda categoria do filtro tem pelo menos uma ação rotulada", () => {
    const known = ["team.member_removed", "conversation.assigned", "opportunity.stage_changed", "contact.created", "group.owner_only_enabled", "task.created", "export.contacts", "whatsapp.channel_connected", "bootstrap.completed"];
    for (const category of AUDIT_CATEGORIES) {
      expect(known.some((action) => categoryOf(action) === category.value)).toBe(true);
    }
    for (const action of known) expect(describeAuditEvent(event(action)).title).not.toBe(action);
  });

  test("ids de membro viram nomes; membro desconhecido vira 'outro membro'", () => {
    const names = new Map([[ANA, "Ana"], [BRUNO, "Bruno"]]);
    expect(describeAuditEvent(event("conversation.assigned", { metadata: { member_id: ANA } }), names).detail).toBe("Responsável: Ana");
    expect(describeAuditEvent(event("conversation.assigned", { metadata: { member_id: ANA, from_member_id: BRUNO } }), names).detail)
      .toBe("Responsável: Ana (no lugar de Bruno)");
    expect(describeAuditEvent(event("conversation.unassigned", { metadata: { member_id: ANA, reason: "reassigned", to_member_id: BRUNO } }), names).detail)
      .toBe("Ana passou a conversa para Bruno");
    expect(describeAuditEvent(event("conversation.unassigned", { metadata: { member_id: ID, reason: "unassigned" } }), names).detail)
      .toBe("Removido: outro membro");
  });

  test("remoção de funcionário resume o que foi liberado", () => {
    const view = describeAuditEvent(event("team.member_removed", { metadata: { ended_conversation_assignments: 2, cleared_opportunities: 3, cleared_tasks: 1 } }));
    expect(view.detail).toBe("Conversas liberadas: 2 · oportunidades: 3 · tarefas: 1");
  });

  test("qualificação lista só nomes de campos (traduzidos), nunca valores", () => {
    const view = describeAuditEvent(event("opportunity.qualification_updated", { metadata: { fields: ["operation_type", "notes", "campo_novo"], notes: "texto digitado" } }));
    expect(view.detail).toBe("Campos: tipo de operação, observações, campo_novo");
    expect(view.detail).not.toContain("texto digitado");
  });

  test("resultado negado ou com falha aparece no título", () => {
    expect(describeAuditEvent(event("export.contacts", { result: "denied" })).title).toBe("Exportação de contatos (negado)");
    expect(describeAuditEvent(event("export.contacts", { result: "failed" })).title).toBe("Exportação de contatos (falhou)");
  });

  test("sistema e membro removido têm nomes de ator claros", () => {
    expect(describeAuditEvent(event("whatsapp.channel_connected", { actor_type: "system", actor_member_id: null, actor_name: null })).actor).toBe("Sistema");
    expect(describeAuditEvent(event("conversation.assigned", { actor_name: null })).actor).toBe("Membro removido");
  });

  test("links só para conversa e oportunidade", () => {
    expect(describeAuditEvent(event("conversation.assigned")).href).toBe(`/conversas/${ID}`);
    expect(describeAuditEvent(event("opportunity.stage_changed", { target_type: "opportunity" })).href).toBe(`/kanban?opportunityId=${ID}`);
    expect(describeAuditEvent(event("contact.created", { target_type: "contact" })).href).toBeNull();
    expect(describeAuditEvent(event("team.member_removed", { target_type: "workspace_member", target_id: null })).href).toBeNull();
  });
});

test.describe("Auditoria: filtros da URL", () => {
  test("valores válidos passam; inválidos são descartados", () => {
    const ok = parseAuditFilters({ categoria: "team", pessoa: ANA, de: "2026-10-01", ate: "2026-10-12" });
    expect(ok).toEqual({ category: "team", actor: ANA, from: "2026-10-01", to: "2026-10-12", cursorTs: null, cursorId: null });
    const bad = parseAuditFilters({ categoria: "'; drop table", pessoa: "não-uuid", de: "ontem", ate: "2026-13-45" });
    expect(bad).toEqual({ category: null, actor: null, from: null, to: null, cursorTs: null, cursorId: null });
  });

  test("cursor só vale com data e id válidos juntos", () => {
    expect(parseAuditFilters({ cursor_ts: "2026-10-12T15:30:00.000Z", cursor_id: ID })).toMatchObject({ cursorTs: "2026-10-12T15:30:00.000Z", cursorId: ID });
    expect(parseAuditFilters({ cursor_ts: "2026-10-12T15:30:00.000Z" })).toMatchObject({ cursorTs: null, cursorId: null });
    expect(parseAuditFilters({ cursor_ts: "agora", cursor_id: ID })).toMatchObject({ cursorTs: null, cursorId: null });
  });

  test("lista de valores na URL usa o primeiro; vazio vira nulo", () => {
    expect(parseAuditFilters({ categoria: ["team", "contact"] }).category).toBe("team");
    expect(parseAuditFilters({ categoria: "  " }).category).toBeNull();
  });

  test("período: 'de' começa o dia e 'até' inclui o dia inteiro (UTC-3)", () => {
    expect(dayStartIso("2026-10-12")).toBe("2026-10-12T03:00:00.000Z");
    expect(dayAfterIso("2026-10-12")).toBe("2026-10-13T03:00:00.000Z");
  });

  test("querystring preserva filtros e acrescenta o cursor", () => {
    const filters = parseAuditFilters({ categoria: "team", de: "2026-10-01" });
    expect(auditQueryString(filters)).toBe("?categoria=team&de=2026-10-01");
    expect(auditQueryString(filters, { ts: "2026-10-12T15:30:00.000Z", id: ID })).toContain("cursor_id=" + ID);
    expect(auditQueryString(parseAuditFilters({}))).toBe("");
  });
});
