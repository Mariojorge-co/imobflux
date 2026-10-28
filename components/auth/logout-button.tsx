"use client";

import { LogOut } from "lucide-react";
import { useState, useTransition } from "react";
import { logoutAction } from "@/app/(auth)/login/actions";
import { ConfirmDialog } from "@/components/quick-replies/confirm-dialog";
import { Button } from "@/components/ui";

/**
 * "bar": botão da barra superior, só no desktop (md+), sem confirmação.
 * "menu": dentro do menu do celular/tablet, longe do sanduíche, com confirmação "Sair do ImobFlux?" (evita toque sem querer).
 */
export function LogoutButton({ variant = "bar" }: { variant?: "bar" | "menu" }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (variant === "menu") {
    return (
      <>
        <Button
          className="min-h-11 w-full justify-start"
          data-testid="logout-menu-button"
          onClick={() => setConfirming(true)}
          type="button"
          variant="ghost"
        >
          <LogOut aria-hidden="true" size={18} strokeWidth={1.8} />
          Sair
        </Button>
        <ConfirmDialog
          confirmLabel="Sair"
          description="Você precisará entrar de novo para usar o ImobFlux neste aparelho."
          destructive
          onCancel={() => setConfirming(false)}
          onConfirm={() => startTransition(async () => { await logoutAction(); })}
          open={confirming}
          pending={pending}
          title="Sair do ImobFlux?"
        />
      </>
    );
  }

  return (
    <form action={logoutAction} className="hidden md:block">
      <Button aria-label="Sair" className="min-h-11" type="submit" variant="ghost">
        <LogOut aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>Sair</span>
      </Button>
    </form>
  );
}
