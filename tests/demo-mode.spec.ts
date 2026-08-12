import { execSync } from "child_process";
import { expect, test } from "@playwright/test";
import {
  cleanDemoMode,
  loadDemoMode,
  resetLocalDatabase,
} from "./helpers/local-test-state";

interface ContactRecord {
  id: string;
  display_name: string;
  classification: string;
}

interface OpportunityRecord {
  id: string;
  title: string;
  status: string;
  operation_type: string;
  financial_analysis_status: string;
  documentation_status: string;
  closed_at: string | null;
  rework_reason: string | null;
}

interface FinancialRecord {
  id: string;
  opportunity_id: string;
  business_value: number | null;
  commission_expected: number | null;
  commission_received: number | null;
}

interface ConversationRecord {
  id: string;
  operational_status: string;
}

interface DemoMemberRecord {
  email: string;
  role: string;
  status: string;
}

function queryPostgresJson<T>(sqlQuery: string): T[] {
  const env = {
    ...process.env,
    PATH: `C:\\Users\\User\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin;${process.env.PATH || ""}`,
  };

  const jsonWrapperQuery = `select json_agg(t) from (${sqlQuery}) t;`;
  const command = `docker exec -i supabase_db_imobflux psql -h 127.0.0.1 -U postgres -d postgres -t -A -c "${jsonWrapperQuery.replace(/"/g, '\\"')}"`;

  const rawOutput = execSync(command, { env, encoding: "utf-8" }).trim();
  if (!rawOutput) return [];
  return JSON.parse(rawOutput) as T[];
}

test.describe("Sprint 22 — Demo Mode Integration & Data Integrity Suite", () => {
  test.beforeAll(() => {
    resetLocalDatabase();
    loadDemoMode();
  });

  test.afterAll(() => {
    cleanDemoMode();
  });

  test("validates presence and integrity of all 20 fictive demo clients and opportunities", async () => {
    // 1. Verificar os 20 contatos de demonstração
    const contacts = queryPostgresJson<ContactRecord>(
      `select id, display_name, classification from public.contacts where id between 'd3300001-0000-4000-8000-000000000001' and 'd3300001-0000-4000-8000-000000000020'`
    );
    expect(contacts).not.toBeNull();
    expect(contacts.length).toBe(20);

    // 2. Verificar as 20 oportunidades de demonstração
    const opportunities = queryPostgresJson<OpportunityRecord>(
      `select id, title, status, operation_type, financial_analysis_status, documentation_status, closed_at, rework_reason from public.opportunities where id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020'`
    );
    expect(opportunities).not.toBeNull();
    expect(opportunities.length).toBe(20);

    // 3. Verificar distribuição de status
    const openOpps = opportunities.filter((o) => o.status === "open");
    const wonOpps = opportunities.filter((o) => o.status === "won");
    const lostOpps = opportunities.filter((o) => o.status === "lost");
    const reworkOpps = opportunities.filter((o) => o.status === "rework");
    const cancelledOpps = opportunities.filter((o) => o.status === "cancelled");

    expect(openOpps.length).toBe(16);
    expect(wonOpps.length).toBe(1);
    expect(lostOpps.length).toBe(1);
    expect(reworkOpps.length).toBe(1);
    expect(cancelledOpps.length).toBe(1);

    // Validações específicas dos status especiais
    expect(wonOpps[0].closed_at).not.toBeNull();
    expect(lostOpps[0].closed_at).not.toBeNull();
    expect(cancelledOpps[0].closed_at).not.toBeNull();
    expect(reworkOpps[0].closed_at).toBeNull();
    expect(reworkOpps[0].rework_reason).toBe("Aguardando inventário imóvel herança Bahia");

    // 4. Verificar os 4 registros financeiros OWNER-only
    const financials = queryPostgresJson<FinancialRecord>(
      `select id, opportunity_id, business_value, commission_expected, commission_received from public.opportunity_financials where opportunity_id between 'd3300002-0000-4000-8000-000000000001' and 'd3300002-0000-4000-8000-000000000020'`
    );
    expect(financials.length).toBe(4);

    // 5. Verificar as 20 conversas e mensagens com deltas temporais
    const conversations = queryPostgresJson<ConversationRecord>(
      `select id, operational_status from public.conversations where id between 'd3300003-0000-4000-8000-000000000001' and 'd3300003-0000-4000-8000-000000000020'`
    );
    expect(conversations.length).toBe(20);

    const members = queryPostgresJson<DemoMemberRecord>(
      "select auth_user.email, member.role, member.status from public.workspace_members as member join public.app_users as app_user on app_user.id = member.user_id join auth.users as auth_user on auth_user.id = app_user.auth_user_id where auth_user.email in ('corretor@imobflux.local', 'atendente@imobflux.local') order by auth_user.email",
    );
    expect(members).toEqual([
      { email: "atendente@imobflux.local", role: "attendant", status: "active" },
      { email: "corretor@imobflux.local", role: "owner", status: "active" },
    ]);

    const privacyFixtures = queryPostgresJson<{ display_name: string; is_protected: boolean }>(
      "select display_name, is_protected from public.contacts where display_name like 'DEMO — Cliente%' order by display_name",
    );
    expect(privacyFixtures).toEqual([
      { display_name: "DEMO — Cliente Liberado Agora", is_protected: false },
      { display_name: "DEMO — Cliente Privado", is_protected: true },
      { display_name: "DEMO — Cliente Público", is_protected: false },
    ]);
  });
});
