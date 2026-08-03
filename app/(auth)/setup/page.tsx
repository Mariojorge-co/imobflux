import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { SetupForm } from "@/components/auth/setup-form";
import { isInitialBootstrapOpen } from "@/lib/auth/dal";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await isInitialBootstrapOpen())) {
    redirect("/login");
  }

  return (
    <AuthCard
      description="Crie o primeiro OWNER e o workspace inicial. Esta operação fica indisponível após a conclusão."
      title="Configuração inicial"
    >
      <SetupForm />
    </AuthCard>
  );
}
