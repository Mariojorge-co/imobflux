"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <Button aria-label="Sair" className="min-h-11" type="submit" variant="ghost">
        <LogOut aria-hidden="true" size={18} strokeWidth={1.8} />
        <span className="hidden sm:inline">Sair</span>
      </Button>
    </form>
  );
}
