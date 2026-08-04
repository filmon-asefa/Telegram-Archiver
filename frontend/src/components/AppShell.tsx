"use client";

import { memo } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

const SidebarMemo = memo(Sidebar);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isChatOpen = pathname.startsWith("/chat/");

  return (
    <div className="app-shell">
      <aside className={`app-sidebar${isChatOpen ? " is-hidden" : ""}`}>
        <SidebarMemo />
      </aside>
      <main className={`app-main${isChatOpen ? " is-active" : ""}`}>
        {children}
      </main>
    </div>
  );
}
