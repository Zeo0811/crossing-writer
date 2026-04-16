import type { ReactNode } from "react";
import { cn } from "./cn";

export interface FormFieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, hint, error, required, className, children }: FormFieldProps) {
  return (
    <label className={cn("block", className)}>
      {label && (
        <span className="text-xs text-[var(--meta)] block mb-1">
          {label}
          {required && <span className="ml-0.5 text-[var(--red)]">*</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="text-[10px] text-[var(--faint)] block mt-1">{hint}</span>}
      {error && <span className="text-[10px] text-[var(--red)] block mt-1">{error}</span>}
    </label>
  );
}
