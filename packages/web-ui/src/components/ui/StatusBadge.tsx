import type { HTMLAttributes } from "react";
import { statusBadge } from "../layout/PhaseSteps";
import type { ProjectStatus } from "../../api/types";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: ProjectStatus | string;
}

export function StatusBadge({ status, className, style, ...rest }: StatusBadgeProps) {
  const tone = statusBadge(status);
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-sm text-[11px] font-medium whitespace-nowrap ${className ?? ""}`}
      style={{ color: tone.fg, background: tone.bg, ...style }}
      {...rest}
    >
      {tone.label}
    </span>
  );
}
