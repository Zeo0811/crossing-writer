import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SectionTitleProps {
  level?: "h1" | "h2" | "h3";
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SectionTitle({ level = "h2", children, action, className }: SectionTitleProps) {
  const sizeCls = level === "h1" ? "text-lg" : level === "h2" ? "text-base" : "text-sm";
  const colorCls = level === "h3" ? "text-[var(--meta)]" : "text-[var(--heading)]";
  const Tag = level;
  return (
    <div className={cn("flex items-center justify-between gap-3 mb-3", className)}>
      <Tag className={cn(sizeCls, colorCls, "font-semibold m-0")}>{children}</Tag>
      {action}
    </div>
  );
}
