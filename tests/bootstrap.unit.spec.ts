import { expect, test } from "@playwright/test";
import {
  executeInitialBootstrap,
  type InitialBootstrapDependencies,
  type InitialBootstrapInput,
} from "@/lib/auth/bootstrap";

const input: InitialBootstrapInput = {
  displayName: "Initial Owner",
  email: "owner@example.test",
  password: "local-test-password",
  timezone: "America/Maceio",
  workspaceName: "Initial Workspace",
};

function dependencies(
  overrides: Partial<InitialBootstrapDependencies> = {},
): InitialBootstrapDependencies {
  return {
    async createAuthUser() {
      return { id: "auth-user-created-by-current-attempt" };
    },
    async createDomain() {},
    async deleteAuthUser() {},
    async findDomainByAuthUserId() {
      return false;
    },
    ...overrides,
  };
}

test("returns complete success when the RPC succeeds", async () => {
  let compensationCalled = false;
  let reconciliationCalled = false;
  const outcome = await executeInitialBootstrap(
    dependencies({
      async deleteAuthUser() {
        compensationCalled = true;
      },
      async findDomainByAuthUserId() {
        reconciliationCalled = true;
        return false;
      },
    }),
    input,
  );

  expect(outcome).toEqual({
    authUserId: "auth-user-created-by-current-attempt",
    status: "success",
  });
  expect(compensationCalled).toBe(false);
  expect(reconciliationCalled).toBe(false);
});

test("distinguishes a definitive failure before domain creation", async () => {
  let rpcCalled = false;
  let compensationCalled = false;
  let reconciliationCalled = false;
  const outcome = await executeInitialBootstrap(
    dependencies({
      async createAuthUser() {
        throw new Error("Auth unavailable");
      },
      async createDomain() {
        rpcCalled = true;
      },
      async deleteAuthUser() {
        compensationCalled = true;
      },
      async findDomainByAuthUserId() {
        reconciliationCalled = true;
        return false;
      },
    }),
    input,
  );

  expect(outcome).toEqual({ status: "auth_creation_failed" });
  expect(rpcCalled).toBe(false);
  expect(compensationCalled).toBe(false);
  expect(reconciliationCalled).toBe(false);
});

test("treats an RPC error as success when reconciliation finds the domain", async () => {
  let compensationCalled = false;
  const reconciledIds: string[] = [];
  const outcome = await executeInitialBootstrap(
    dependencies({
      async createDomain() {
        throw new Error("RPC response was lost");
      },
      async deleteAuthUser() {
        compensationCalled = true;
      },
      async findDomainByAuthUserId(authUserId) {
        reconciledIds.push(authUserId);
        return true;
      },
    }),
    input,
  );

  expect(outcome).toEqual({
    authUserId: "auth-user-created-by-current-attempt",
    status: "success_reconciled",
  });
  expect(reconciledIds).toEqual(["auth-user-created-by-current-attempt"]);
  expect(compensationCalled).toBe(false);
});

test("compensates only the current UUID when reconciliation proves absence", async () => {
  const deletedIds: string[] = [];
  const reconciledIds: string[] = [];
  const outcome = await executeInitialBootstrap(
    dependencies({
      async createDomain() {
        throw new Error("RPC failed");
      },
      async deleteAuthUser(authUserId) {
        deletedIds.push(authUserId);
      },
      async findDomainByAuthUserId(authUserId) {
        reconciledIds.push(authUserId);
        return false;
      },
    }),
    input,
  );

  expect(outcome).toEqual({
    status: "domain_creation_failed_compensated",
  });
  expect(reconciledIds).toEqual(["auth-user-created-by-current-attempt"]);
  expect(deletedIds).toEqual(["auth-user-created-by-current-attempt"]);
});

test("reports an ambiguous result without compensation when reconciliation fails", async () => {
  let compensationCalled = false;
  const outcome = await executeInitialBootstrap(
    dependencies({
      async createDomain() {
        throw new Error("RPC failed");
      },
      async deleteAuthUser() {
        compensationCalled = true;
      },
      async findDomainByAuthUserId() {
        throw new Error("Reconciliation unavailable");
      },
    }),
    input,
  );

  expect(outcome).toEqual({
    authUserId: "auth-user-created-by-current-attempt",
    status: "domain_creation_ambiguous",
  });
  expect(compensationCalled).toBe(false);
});

test("reports an orphan when compensation fails after confirmed absence", async () => {
  const deletedIds: string[] = [];
  const outcome = await executeInitialBootstrap(
    dependencies({
      async createDomain() {
        throw new Error("RPC failed");
      },
      async deleteAuthUser(authUserId) {
        deletedIds.push(authUserId);
        throw new Error("Compensation failed");
      },
      async findDomainByAuthUserId() {
        return false;
      },
    }),
    input,
  );

  expect(outcome).toEqual({
    authUserId: "auth-user-created-by-current-attempt",
    status: "domain_creation_failed_orphaned",
  });
  expect(deletedIds).toEqual(["auth-user-created-by-current-attempt"]);
});
