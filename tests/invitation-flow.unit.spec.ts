try {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} };
} catch {
  // server-only is intentionally bypassed in unit tests.
}

import { expect, test } from "@playwright/test";
import { getPendingInvitationForUser } from "@/lib/auth/invitation";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminModule = require("@/lib/supabase/admin") as { createAdminSupabaseClient: () => unknown };
const originalAdmin = adminModule.createAdminSupabaseClient;

function mockAdmin(row: unknown, error: unknown = null) {
  adminModule.createAdminSupabaseClient = () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        limit: () => query,
        maybeSingle: async () => ({ data: row, error }),
      };
      return query;
    },
  });
}

test.afterEach(() => { adminModule.createAdminSupabaseClient = originalAdmin; });

test("accepts only an unexpired attendant invitation for the authenticated email", async () => {
  mockAdmin({
    id: "app-user",
    workspace_members: [{
      id: "member",
      workspace_id: "workspace",
      role: "attendant",
      status: "invited",
      invited_email_normalized: "staff@example.com",
      invitation_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }],
  });
  await expect(getPendingInvitationForUser("auth-user", "STAFF@example.com")).resolves.toMatchObject({ memberId: "member", workspaceId: "workspace" });
});

test("rejects an expired invitation without exposing membership details", async () => {
  mockAdmin({
    id: "app-user",
    workspace_members: [{
      id: "member",
      workspace_id: "workspace",
      role: "attendant",
      status: "invited",
      invited_email_normalized: "staff@example.com",
      invitation_expires_at: new Date(Date.now() - 60_000).toISOString(),
    }],
  });
  await expect(getPendingInvitationForUser("auth-user", "staff@example.com")).resolves.toBeNull();
});
