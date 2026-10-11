import Link from "next/link";
import { Button } from "@/components/ui";
import { AuthCard } from "./auth-card";

export function SessionConflict({ action }: { action: () => Promise<void> }) {
  return <AuthCard title="Outra conta está conectada" description="O link não foi consumido.">
    <div className="space-y-stack">
      <p role="status" className="rounded-control border border-warning-border bg-warning-soft p-control-x text-body">
        Abra o link em uma janela anônima ou outro navegador. Se preferir continuar aqui, encerre explicitamente a sessão atual.
      </p>
      <form action={action}><Button className="w-full" type="submit">Sair da conta atual e continuar</Button></form>
      <Link className="block text-center text-caption text-text underline-offset-4 hover:underline" href="/login">Cancelar</Link>
    </div>
  </AuthCard>;
}
