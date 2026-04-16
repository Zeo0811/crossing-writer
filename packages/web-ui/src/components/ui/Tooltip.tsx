import * as RadixTooltip from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";

export function TooltipProvider({ children, delay = 300 }: { children: ReactNode; delay?: number }) {
  return <RadixTooltip.Provider delayDuration={delay}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded bg-[var(--bg-1)] border border-[var(--hair-strong)] px-2 py-1 text-xs text-[var(--body)] shadow-lg max-w-[240px]"
        >
          {content}
          <RadixTooltip.Arrow className="fill-[var(--bg-1)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
