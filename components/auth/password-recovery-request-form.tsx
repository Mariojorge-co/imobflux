"use client";

import { useActionState } from "react";
import { requestPasswordResetAction } from "@/app/(auth)/redefinir-senha/actions";
import { Button, Input } from "@/components/ui";

export function PasswordRecoveryRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, { message: "", status: "idle" as const });
  return <form action={action} className="space-y-stack"><label className="text-body font-medium text-text" htmlFor="email">E-mail</label><Input id="email" name="email" type="email" autoComplete="email" required />{state.message ? <p role="status" aria-live="polite" className="text-body text-text">{state.message}</p> : null}<Button className="w-full" disabled={pending} type="submit">{pending ? "Enviando..." : "Enviar instruções"}</Button></form>;
}
