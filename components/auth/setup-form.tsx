"use client";

import { useActionState } from "react";
import { setupAction } from "@/app/(auth)/setup/actions";
import { Button, Input } from "@/components/ui";
import { initialAuthActionState } from "@/lib/auth/validation";

export function SetupForm() {
  const [state, formAction, pending] = useActionState(
    setupAction,
    initialAuthActionState,
  );

  return (
    <form action={formAction} className="space-y-stack">
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text" htmlFor="displayName">
          Nome do responsável
        </label>
        <Input
          autoComplete="name"
          id="displayName"
          name="displayName"
          required
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-body font-medium text-text" htmlFor="workspaceName">
          Nome do workspace
        </label>
        <Input id="workspaceName" name="workspaceName" required />
      </div>
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
          autoComplete="new-password"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>
      <div className="space-y-1.5">
        <label
          className="text-body font-medium text-text"
          htmlFor="bootstrapToken"
        >
          Token de configuração
        </label>
        <Input
          autoComplete="off"
          id="bootstrapToken"
          name="bootstrapToken"
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
        {pending ? "Configurando..." : "Criar workspace"}
      </Button>
    </form>
  );
}
