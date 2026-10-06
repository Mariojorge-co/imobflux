import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { InvitationPasswordForm } from "@/components/auth/invitation-password-form";
import { getAuthenticatedUser, getOptionalActiveAccess } from "@/lib/auth/dal";
import { Button } from "@/components/ui";
import { continueInvitationAction } from "./actions";
import { getPendingInvitationForUser } from "@/lib/auth/invitation";

type InvitationPageProps = {
  searchParams: Promise<{ error?: string; flow?: string }>;
};

export const dynamic = "force-dynamic";

export default async function InvitationPage({ searchParams }: InvitationPageProps) {
  const [user, access, query] = await Promise.all([
    getAuthenticatedUser(),
    getOptionalActiveAccess(),
    searchParams,
  ]);

  if (access) redirect("/prioridades");
  const pending = user?.email ? await getPendingInvitationForUser(user.id, user.email) : null;
  if (query.error === "session_conflict") {
    return <AuthCard title="Outra conta está conectada" description="Para sua segurança, o convite não foi consumido."><div className="space-y-stack"><p role="status" className="rounded-control border border-warning-border bg-warning-soft p-control-x text-body">Você está conectado em outra conta.</p><form action={continueInvitationAction}><Button className="w-full" type="submit">Sair e continuar com o convite</Button></form><Link className="block text-center text-caption text-text underline-offset-4 hover:underline" href="/login">Cancelar</Link></div></AuthCard>;
  }

  const errorMessage = query.error === "expired"
    ? "Este convite expirou. Peça ao responsável pela equipe para reenviar."
    : "Este convite é inválido ou já foi utilizado.";

  return (
    <AuthCard
      description="Defina uma senha pessoal para concluir seu acesso como funcionário."
      title="Aceitar convite"
    >
      {user && pending ? (
        <InvitationPasswordForm />
      ) : (
        <div className="space-y-stack text-body">
          <p className="rounded-control border border-danger-border bg-danger-soft p-control-x text-danger">
            {errorMessage}
          </p>
          <Link className="font-medium text-text underline-offset-4 hover:underline" href="/login">
            Voltar para o login
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
