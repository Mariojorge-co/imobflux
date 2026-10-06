import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { getAuthenticatedUser } from "@/lib/auth/dal";
import { PasswordRecoveryRequestForm } from "@/components/auth/password-recovery-request-form";
import { PasswordResetForm } from "@/components/auth/password-reset-form";
import { Button } from "@/components/ui";
import { continueRecoveryAction } from "./conflict-actions";

export const dynamic = "force-dynamic";

export default async function PasswordResetPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getAuthenticatedUser();
  const query = await searchParams;
  if (query.error === "session_conflict") return <AuthCard title="Outra conta está conectada" description="Para sua segurança, a recuperação não foi consumida."><div className="space-y-stack"><p role="status" className="rounded-control border border-warning-border bg-warning-soft p-control-x text-body">Você está conectado em outra conta.</p><form action={continueRecoveryAction}><Button className="w-full" type="submit">Sair e continuar recuperação</Button></form><Link className="block text-center text-caption text-text underline-offset-4 hover:underline" href="/login">Cancelar</Link></div></AuthCard>;
  return <AuthCard title={user ? "Definir nova senha" : "Recuperar senha"} description={user ? "Escolha uma nova senha para sua conta." : "Enviaremos instruções para o e-mail informado."}>
    {user ? <PasswordResetForm /> : <><PasswordRecoveryRequestForm /><Link className="text-caption text-text underline-offset-4 hover:underline" href="/login">Voltar para o login</Link></>}
  </AuthCard>;
}
