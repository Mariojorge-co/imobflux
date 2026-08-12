"use client";

import { useActionState } from "react";
import {
  acceptInvitationAction,
} from "@/app/(auth)/convite/actions";
import { Button, Input } from "@/components/ui";

export function InvitationPasswordForm() {
  const [state, action, pending] = useActionState(
    acceptInvitationAction,
    { message: "", status: "idle" } as const,
  );

  return (
    <form action={action} className="space-y-stack">
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text" htmlFor="password">
          Crie sua senha
        </label>
        <Input autoComplete="new-password" id="password" minLength={8} name="password" required type="password" />
      </div>
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text" htmlFor="passwordConfirmation">
          Confirme sua senha
        </label>
        <Input autoComplete="new-password" id="passwordConfirmation" minLength={8} name="passwordConfirmation" required type="password" />
      </div>
      {state.message ? <p aria-live="polite" className="text-body text-danger" role="status">{state.message}</p> : null}
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "Ativando acesso..." : "Definir senha e entrar"}
      </Button>
    </form>
  );
}
