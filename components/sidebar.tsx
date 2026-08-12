"use client";

import Link from "next/link";
import { Columns3, ContactRound, ListChecks, MessageCircle, Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import { classNames } from "@/lib/class-names";

const navigationItems = [
  {
    href: "/prioridades",
    label: "Prioridades",
    icon: ListChecks,
  },
  {
    href: "/contatos",
    label: "Contatos",
    icon: ContactRound,
  },
  {
    href: "/conversas",
    label: "Conversas",
    icon: MessageCircle,
  },
  {
    href: "/kanban",
    label: "Kanban",
    icon: Columns3,
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: Settings,
  },
];

type NavigationLinksProps = {
  onNavigate?: () => void;
  role: "owner" | "attendant";
};

export function NavigationLinks({ onNavigate, role }: NavigationLinksProps) {
  const pathname = usePathname();
  const visibleItems = role === "owner"
    ? navigationItems
    : navigationItems.filter((item) => item.href !== "/configuracoes");

  return (
    <nav aria-label="Navegação principal" className="p-stack">
      <ul className="space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                aria-current={isActive ? "page" : undefined}
                className={classNames(
                  "flex min-h-11 items-center gap-3 rounded-control px-control-x py-control-y text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-text-muted hover:bg-neutral-soft hover:text-text",
                )}
                href={item.href}
                onClick={onNavigate}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar({ role }: { role: "owner" | "attendant" }) {
  return (
    <aside className="hidden min-h-screen w-sidebar shrink-0 flex-col border-r border-border bg-surface md:flex">
      <div className="flex h-topbar items-center border-b border-border px-page">
        <span className="text-xl font-bold tracking-tight text-text">
          ImobFlux
        </span>
      </div>

      <NavigationLinks role={role} />
    </aside>
  );
}
