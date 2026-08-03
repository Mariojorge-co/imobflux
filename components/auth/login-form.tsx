"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/(auth)/login/actions";
import { Button, Input } from "@/components/ui";
import { initialAuthActionState } from "@/lib/auth/validation";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    loginAction,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-stack">
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text" htmlFor="email">
          E-mail
        </label>
        <Input
          autoComplete="email"
          id="email"
          name="email"
          required
          type="email"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text" htmlFor="password">
          Senha
        </label>
        <Input
          autoComplete="current-password"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>
      {state.message ? (
        <p
          aria-live="polite"
          className="text-body text-danger"
          role="status"
        >
          {state.message}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
