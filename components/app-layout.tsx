import type { ReactNode } from "react";
import { NewMessageNotifier } from "@/components/notifications/new-message-notifier";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

type AppLayoutProps = {
  children: ReactNode;
  /** Quem está logado: as preferências de aviso são pessoais. */
  memberId: string;
  role: "owner" | "attendant";
};

export function AppLayout({ children, memberId, role }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <NewMessageNotifier memberId={memberId} />
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar role={role} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
