import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { InvitationPasswordForm } from "@/components/auth/invitation-password-form";
import { getAuthenticatedUser, getOptionalActiveAccess } from "@/lib/auth/dal";

type InvitationPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export default async function InvitationPage({ searchParams }: InvitationPageProps) {
  const [user, access, query] = await Promise.all([
    getAuthenticatedUser(),
    getOptionalActiveAccess(),
    searchParams,
  ]);

  if (access) redirect("/prioridades");

  const errorMessage = query.error === "expired"
    ? "Este convite expirou. Peça ao responsável pela equipe para reenviar."
    : "Este convite é inválido ou já foi utilizado.";

  return (
    <AuthCard
      description="Defina uma senha pessoal para concluir seu acesso como funcionário."
      title="Aceitar convite"
    >
      {user ? (
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
