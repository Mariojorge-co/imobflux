"use client";

import { Menu, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { GlobalShortcuts } from "@/components/global-shortcuts";
import { GlobalSearch } from "@/components/search/global-search";
import { ThemeCycleButton } from "@/components/theme-controls";
import { NavigationLinks } from "@/components/sidebar";
import { Button } from "@/components/ui";
import { ESCAPE_PRIORITY, useEscapeLayer } from "@/lib/ui/escape-stack";

export function Topbar({ role }: { role: "owner" | "attendant" }) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEscapeLayer(isNavigationOpen, ESCAPE_PRIORITY.drawer, () => {
    setIsNavigationOpen(false);
    menuButtonRef.current?.focus();
  });

  return (
    <header
      aria-label="Barra superior"
      className="sticky top-0 z-30 h-topbar border-b border-border bg-surface lg:static"
    >
      <div className="flex h-full items-center justify-between px-stack sm:px-page">
        <span className="text-xl font-bold tracking-tight text-text lg:hidden">
          ImobFlux
        </span>
        <div className="ml-auto flex items-center gap-4 lg:gap-inline">
          <GlobalSearch />
          <GlobalShortcuts />
          <ThemeCycleButton />
          <Link
            aria-label="Preferências"
            className="flex size-11 items-center justify-center rounded-control text-text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:size-9"
            data-testid="preferences-link"
            href="/preferencias"
            title="Preferências (tema e notificações)"
          >
            <SlidersHorizontal aria-hidden="true" size={18} />
          </Link>
          <LogoutButton />
          <Button
            aria-controls="mobile-navigation"
            aria-expanded={isNavigationOpen}
            aria-label={
              isNavigationOpen ? "Fechar menu principal" : "Abrir menu principal"
            }
            className="size-11 p-0 lg:hidden"
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
          className="absolute inset-x-0 top-full border-b border-border bg-surface lg:hidden"
          id="mobile-navigation"
        >
          <NavigationLinks
            onNavigate={() => setIsNavigationOpen(false)}
            role={role}
          />
          <div className="border-t border-border px-stack py-4">
            <LogoutButton variant="menu" />
          </div>
        </div>
      ) : null}
    </header>
  );
}
