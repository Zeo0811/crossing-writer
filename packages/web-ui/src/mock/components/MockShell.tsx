import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { SideNav } from "./SideNav";
import { MockToastHost } from "./MockToastHost";
import { CommandPalette } from "./CommandPalette";
import { MockStateSwitcher } from "./MockStateSwitcher";

export function MockShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-0)] text-[var(--body)]">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <SideNav />
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>
      <MockToastHost />
      <CommandPalette />
      <MockStateSwitcher />
    </div>
  );
}
