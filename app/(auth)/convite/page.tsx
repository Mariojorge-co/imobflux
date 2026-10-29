import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { InvitationPasswordForm } from "@/components/auth/invitation-password-form";
import { getActiveAccessForAuthUser, getAuthenticatedUser } from "@/lib/auth/dal";
import { continueInvitationAction } from "./actions";
import { lookupInvitationForUser } from "@/lib/auth/invitation";
import { getConfirmedFlow } from "@/lib/auth/confirmed-flow";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SessionConflict } from "@/components/auth/session-conflict";
import { authFlowErrorMessage } from "@/lib/auth/email-flow";

type InvitationPageProps = {
  searchParams: Promise<{ error?: string; flow?: string }>;
};

export const dynamic = "force-dynamic";

export default async function InvitationPage({ searchParams }: InvitationPageProps) {
  const query = await searchParams;
  if (query.error === "session_conflict") return <SessionConflict action={continueInvitationAction} />;
  let error = query.error;
  let flow = null;
  let accepted = false;
  if (!error) {
    try {
      const user = await getAuthenticatedUser();
      flow = user ? await getConfirmedFlow(await createServerSupabaseClient(), user.id) : null;
      if (!user?.email || !flow) error = "invalid";
      else {
        const lookup = await lookupInvitationForUser(user.id, user.email);
        if (lookup.status === "not_found" && flow.phase === "password_defined" && flow.memberId && flow.workspaceId) {
          const access = await getActiveAccessForAuthUser(user.id);
          accepted = !!access && access.memberId === flow.memberId && access.workspaceId === flow.workspaceId && access.role === "attendant";
        }
        if (lookup.status !== "pending" && !accepted) error = lookup.status === "expired" ? "invitation_expired" : lookup.status === "technical" ? "technical" : "invalid";
      }
    } catch { error = "technical"; }
  }
  if (accepted) redirect("/hoje");

  return (
    <AuthCard
      description="Defina uma senha pessoal para concluir seu acesso como funcionário."
      title="Aceitar convite"
    >
      {!error && flow ? (
        <InvitationPasswordForm passwordDefined={flow.phase === "password_defined"} />
      ) : (
        <div className="space-y-stack text-body">
          <p className="rounded-control border border-danger-border bg-danger-soft p-control-x text-danger">
            {authFlowErrorMessage(error)}
          </p>
          <Link className="font-medium text-text underline-offset-4 hover:underline" href="/login">
            Voltar para o login
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
