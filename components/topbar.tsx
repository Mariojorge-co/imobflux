"use client";

import { Keyboard, Menu, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { GlobalShortcuts, OPEN_SHORTCUTS_EVENT } from "@/components/global-shortcuts";
import { GlobalSearch } from "@/components/search/global-search";
import { ThemeCycleButton } from "@/components/theme-controls";
import { NavigationLinks } from "@/components/sidebar";
import { Button } from "@/components/ui";
import { ESCAPE_PRIORITY, useEscapeLayer } from "@/lib/ui/escape-stack";

export function Topbar({ role }: { role: "owner" | "attendant" }) {
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Fechar por qualquer caminho (Esc, toque fora, escolher uma tela) devolve o foco ao botão ☰.
  const closeNavigation = () => {
    setIsNavigationOpen(false);
    menuButtonRef.current?.focus();
  };
  useEscapeLayer(isNavigationOpen, ESCAPE_PRIORITY.drawer, closeNavigation);

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
        <>
        {/* Fundo escuro: tocar fora do menu o fecha (é um botão, então o toque também funciona no iOS). */}
        <button
          aria-label="Fechar menu principal"
          className="fixed inset-x-0 bottom-0 top-topbar -z-10 bg-text/40 lg:hidden"
          data-testid="nav-backdrop"
          onClick={closeNavigation}
          tabIndex={-1}
          type="button"
        />
        <div
          className="absolute inset-x-0 top-full border-b border-border bg-surface lg:hidden"
          id="mobile-navigation"
        >
          <NavigationLinks
            onNavigate={closeNavigation}
            role={role}
          />
          <div className="space-y-4 border-t border-border px-stack py-4">
            <button
              className="flex min-h-11 w-full items-center gap-3 rounded-control px-1 text-left text-body text-text hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="menu-shortcuts"
              onClick={() => {
                setIsNavigationOpen(false);
                window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
              }}
              type="button"
            >
              <Keyboard aria-hidden="true" className="text-text-muted" size={18} /> Atalhos do teclado
            </button>
            <LogoutButton variant="menu" />
          </div>
        </div>
        </>
      ) : null}
    </header>
  );
}
