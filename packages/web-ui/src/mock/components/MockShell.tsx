import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { MockToastHost } from "./MockToastHost";
import { CommandPalette } from "./CommandPalette";
import { MockStateSwitcher } from "./MockStateSwitcher";

export function MockShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-0)] text-[var(--body)]">
      <div className="max-w-[1280px] mx-auto px-5 pt-7 pb-[72px] flex flex-col gap-7">
        <TopBar />
        <main>{children}</main>
      </div>
      <MockToastHost />
      <CommandPalette />
      <MockStateSwitcher />
    </div>
  );
}
