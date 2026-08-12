"use client";

import { Menu, X } from "lucide-react";
import { useRef, useState } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { NavigationLinks } from "@/components/sidebar";
import { Button } from "@/components/ui";

export function Topbar({ role }: { role: "owner" | "attendant" }) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <header
      aria-label="Barra superior"
      className="sticky top-0 z-30 h-topbar border-b border-border bg-surface md:static"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isNavigationOpen) {
          setIsNavigationOpen(false);
          menuButtonRef.current?.focus();
        }
      }}
    >
      <div className="flex h-full items-center justify-between px-stack sm:px-page">
        <span className="text-xl font-bold tracking-tight text-text md:hidden">
          ImobFlux
        </span>
        <div className="ml-auto flex items-center gap-inline">
          <LogoutButton />
          <Button
            aria-controls="mobile-navigation"
            aria-expanded={isNavigationOpen}
            aria-label={
              isNavigationOpen ? "Fechar menu principal" : "Abrir menu principal"
            }
            className="size-11 p-0 md:hidden"
            onClick={() => setIsNavigationOpen((isOpen) => !isOpen)}
            ref={menuButtonRef}
            variant="ghost"
          >
            {isNavigationOpen ? (
              <X aria-hidden="true" size={20} strokeWidth={1.8} />
            ) : (
              <Menu aria-hidden="true" size={20} strokeWidth={1.8} />
            )}
          </Button>
        </div>
      </div>

      {isNavigationOpen ? (
        <div
          className="absolute inset-x-0 top-full border-b border-border bg-surface md:hidden"
          id="mobile-navigation"
        >
          <NavigationLinks
            onNavigate={() => setIsNavigationOpen(false)}
            role={role}
          />
        </div>
      ) : null}
    </header>
  );
}
