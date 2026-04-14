import type { ReactNode } from "react";

export type ChipVariant = "active" | "waiting" | "warn" | "legacy" | "deleted";

interface ChipProps {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
}

const CONFIG: Record<ChipVariant, { dot: string; dotClass: string; wrap: string }> = {
  active: {
    dot: "●",
    dotClass: "text-accent",
    wrap: "bg-bg-2 text-body border-hair",
  },
  waiting: {
    dot: "○",
    dotClass: "text-faint",
    wrap: "bg-bg-2 text-meta border-hair",
  },
  warn: {
    dot: "◉",
    dotClass: "text-amber",
    wrap: "bg-[var(--amber-bg)] text-amber border-[var(--amber-hair)]",
  },
  legacy: {
    dot: "▣",
    dotClass: "text-meta",
    wrap: "bg-bg-2 text-meta border-hair",
  },
  deleted: {
    dot: "●",
    dotClass: "text-red",
    wrap: "bg-bg-2 text-meta border-hair line-through",
  },
};

export function Chip({ variant = "active", children, className = "" }: ChipProps) {
  const c = CONFIG[variant];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-[3px] border rounded-[2px] font-sans tracking-[0.02em] ${c.wrap} ${className}`.trim()}
    >
      <span className={`w-2 text-center ${c.dotClass}`}>{c.dot}</span>
      {children}
    </span>
  );
}
