import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { getOptionalActiveAccess, isInitialBootstrapOpen } from "@/lib/auth/dal";

type LoginPageProps = {
  searchParams: Promise<{
    reason?: string | string[];
    setup?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [access, setupOpen, query] = await Promise.all([
    getOptionalActiveAccess(),
    isInitialBootstrapOpen(),
    searchParams,
  ]);

  if (access) {
    redirect("/prioridades");
  }

  const accessDenied = query.reason === "access_denied";
  const setupComplete = query.setup === "complete";

  return (
    <AuthCard
      description="Acesse seu workspace com a conta configurada."
      title="Entrar no ImobFlux"
    >
      {accessDenied ? (
        <p className="rounded-control border border-danger-border bg-danger-soft p-control-x text-body text-danger">
          Esta conta não possui acesso ativo ao ImobFlux.
        </p>
      ) : null}
      {setupComplete ? (
        <p className="rounded-control border border-success-border bg-success-soft p-control-x text-body text-success">
          Configuração concluída. Entre para continuar.
        </p>
      ) : null}
      <LoginForm />
      <p className="text-center text-caption text-text-muted"><Link className="underline-offset-4 hover:underline" href="/redefinir-senha">Esqueci minha senha</Link></p>
      {setupOpen ? (
        <p className="text-center text-caption text-text-muted">
          Primeira utilização?{" "}
          <Link
            className="font-medium text-text underline-offset-4 hover:underline"
            href="/setup"
          >
            Configurar workspace
          </Link>
        </p>
      ) : null}
    </AuthCard>
  );
}
