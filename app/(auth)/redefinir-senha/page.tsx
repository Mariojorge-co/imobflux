import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { getAuthenticatedUser } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { PasswordRecoveryRequestForm } from "@/components/auth/password-recovery-request-form";
import { PasswordResetForm } from "@/components/auth/password-reset-form";
import { continueRecoveryAction } from "./conflict-actions";
import { SessionConflict } from "@/components/auth/session-conflict";
import { authFlowErrorMessage } from "@/lib/auth/email-flow";
import { getConfirmedFlow } from "@/lib/auth/confirmed-flow";
import { lookupInvitationForUser } from "@/lib/auth/invitation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PasswordResetPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  if (query.error === "session_conflict") return <SessionConflict action={continueRecoveryAction} />;
  let error = query.error;
  let allowed = false;
  let pending = false;
  if (!error) {
    try {
      const user = await getAuthenticatedUser();
      if (user) {
        const flow = await getConfirmedFlow(await createServerSupabaseClient(), user.id);
        if (!flow || flow.type !== "recovery" || !user.email) error = "invalid";
        else {
          const lookup = await lookupInvitationForUser(user.id, user.email);
          if (lookup.status === "technical" || lookup.status === "expired") error = lookup.status === "expired" ? "invitation_expired" : "technical";
          else { pending = lookup.status === "pending"; allowed = true; }
        }
      }
    } catch { error = "technical"; }
  }
  if (pending) redirect("/convite");
  return <AuthCard title={allowed ? "Definir nova senha" : "Recuperar senha"} description={allowed ? "Escolha uma nova senha para sua conta." : "Enviaremos instruções para o e-mail informado."}>
    {error ? <p role="status" className="text-body text-danger">{authFlowErrorMessage(error)}</p> : null}
    {allowed && !error ? <PasswordResetForm /> : <><PasswordRecoveryRequestForm /><Link className="text-caption text-text underline-offset-4 hover:underline" href="/login">Voltar para o login</Link></>}
  </AuthCard>;
}
