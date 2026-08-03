"use server";

import { redirect } from "next/navigation";
import {
  executeInitialBootstrap,
  type InitialBootstrapInput,
} from "@/lib/auth/bootstrap";
import { isInitialBootstrapOpen } from "@/lib/auth/dal";
import {
  assertTrustedServerActionOrigin,
  isValidBootstrapToken,
} from "@/lib/auth/security";
import {
  type AuthActionState,
  validateSetupForm,
} from "@/lib/auth/validation";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const timezone = "America/Maceio";

export async function setupAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    await assertTrustedServerActionOrigin();
  } catch {
    return { message: "Operação não permitida.", status: "error" };
  }

  const formInput = validateSetupForm(formData);

  if (!formInput || !isValidBootstrapToken(formInput.bootstrapToken)) {
    return {
      message: "Não foi possível validar a configuração inicial.",
      status: "error",
    };
  }

  if (!(await isInitialBootstrapOpen())) {
    return {
      message: "A configuração inicial já foi concluída.",
      status: "error",
    };
  }

  const input: InitialBootstrapInput = {
    displayName: formInput.displayName,
    email: formInput.email,
    password: formInput.password,
    timezone,
    workspaceName: formInput.workspaceName,
  };
  const admin = createAdminSupabaseClient();

  const outcome = await executeInitialBootstrap(
    {
      async createAuthUser(authInput) {
        const { data, error } = await admin.auth.admin.createUser({
          email: authInput.email,
          email_confirm: true,
          password: authInput.password,
          user_metadata: { display_name: authInput.displayName },
        });

        if (error || !data.user) {
          throw new Error("Auth user creation failed");
        }

        return { id: data.user.id };
      },
      async createDomain(authUserId, domainInput) {
        const { error } = await admin.rpc("bootstrap_initial_workspace", {
          p_auth_user_id: authUserId,
          p_display_name: domainInput.displayName,
          p_timezone: domainInput.timezone,
          p_workspace_name: domainInput.workspaceName,
        });

        if (error) {
          throw new Error("Domain bootstrap failed");
        }
      },
      async findDomainByAuthUserId(authUserId) {
        const { data, error } = await admin
          .from("app_users")
          .select("id")
          .eq("auth_user_id", authUserId)
          .limit(1)
          .maybeSingle();

        if (error) {
          throw new Error("Domain reconciliation failed");
        }

        return data !== null;
      },
      async deleteAuthUser(authUserId) {
        const { error } = await admin.auth.admin.deleteUser(authUserId);

        if (error) {
          throw new Error("Auth compensation failed");
        }
      },
    },
    input,
  );

  if (outcome.status === "auth_creation_failed") {
    return {
      message: "Não foi possível criar a conta inicial.",
      status: "error",
    };
  }

  if (outcome.status === "domain_creation_failed_compensated") {
    return {
      message: "A configuração não foi concluída. Tente novamente.",
      status: "error",
    };
  }

  if (outcome.status === "domain_creation_ambiguous") {
    console.error("Bootstrap outcome requires administrative reconciliation.", {
      authUserId: outcome.authUserId,
    });
    return {
      message:
        "O resultado da configuração não pôde ser confirmado e requer recuperação administrativa.",
      status: "error",
    };
  }

  if (outcome.status === "domain_creation_failed_orphaned") {
    console.error("Bootstrap requires administrative Auth recovery.", {
      authUserId: outcome.authUserId,
    });
    return {
      message:
        "A configuração não foi concluída e requer recuperação administrativa.",
      status: "error",
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    redirect("/login?setup=complete");
  }

  redirect("/prioridades");
}
