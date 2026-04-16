import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  variant?: "default" | "primary";
  className?: string;
}

export function EmptyState({ icon, title, body, action, variant = "default", className }: EmptyStateProps) {
  const primary = variant === "primary";
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center rounded py-16 px-8",
        primary ? "bg-[var(--bg-2)]" : "bg-[var(--bg-2)]",
        className,
      )}
    >
      {icon && <div className="mb-5">{icon}</div>}
      {title && <h2 className="text-xl font-semibold text-[var(--heading)] mb-2">{title}</h2>}
      {body && <p className="text-sm text-[var(--meta)] mb-7 max-w-[420px] leading-relaxed">{body}</p>}
      {action}
    </div>
  );
}
