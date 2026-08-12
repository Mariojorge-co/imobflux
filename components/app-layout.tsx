import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

type AppLayoutProps = {
  children: ReactNode;
  role: "owner" | "attendant";
};

export function AppLayout({ children, role }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar role={role} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
