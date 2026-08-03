export type InitialBootstrapInput = {
  displayName: string;
  email: string;
  password: string;
  timezone: string;
  workspaceName: string;
};

export type InitialBootstrapDependencies = {
  createAuthUser: (input: InitialBootstrapInput) => Promise<{ id: string }>;
  createDomain: (
    authUserId: string,
    input: InitialBootstrapInput,
  ) => Promise<void>;
  deleteAuthUser: (authUserId: string) => Promise<void>;
  findDomainByAuthUserId: (authUserId: string) => Promise<boolean>;
};

export type InitialBootstrapOutcome =
  | { authUserId: string; status: "success" }
  | { authUserId: string; status: "success_reconciled" }
  | { status: "auth_creation_failed" }
  | { status: "domain_creation_failed_compensated" }
  | { authUserId: string; status: "domain_creation_failed_orphaned" }
  | { authUserId: string; status: "domain_creation_ambiguous" };

export async function executeInitialBootstrap(
  dependencies: InitialBootstrapDependencies,
  input: InitialBootstrapInput,
): Promise<InitialBootstrapOutcome> {
  let authUserId: string;

  try {
    const authUser = await dependencies.createAuthUser(input);
    authUserId = authUser.id;
  } catch {
    return { status: "auth_creation_failed" };
  }

  try {
    await dependencies.createDomain(authUserId, input);
    return { authUserId, status: "success" };
  } catch {
    let domainExists: boolean;

    try {
      domainExists = await dependencies.findDomainByAuthUserId(authUserId);
    } catch {
      return {
        authUserId,
        status: "domain_creation_ambiguous",
      };
    }

    if (domainExists) {
      return {
        authUserId,
        status: "success_reconciled",
      };
    }

    try {
      await dependencies.deleteAuthUser(authUserId);
      return { status: "domain_creation_failed_compensated" };
    } catch {
      return {
        authUserId,
        status: "domain_creation_failed_orphaned",
      };
    }
  }
}
