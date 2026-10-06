"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { updatePasswordAction } from "@/app/(auth)/redefinir-senha/actions";

export function PasswordResetForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, { message: "", status: "error" as const });
  return <form action={action} className="space-y-stack"><label className="text-body font-medium text-text" htmlFor="password">Nova senha</label><Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required /><label className="text-body font-medium text-text" htmlFor="passwordConfirmation">Confirme a nova senha</label><Input id="passwordConfirmation" name="passwordConfirmation" type="password" minLength={8} autoComplete="new-password" required />{state.message ? <p role="status" aria-live="polite" className="text-body text-text">{state.message}</p> : null}<Button className="w-full" disabled={pending} type="submit">{pending ? "Salvando..." : "Salvar nova senha"}</Button></form>;
}
