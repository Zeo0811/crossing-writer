import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full bg-[var(--bg-2)] border rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)] placeholder:text-[var(--faint)] resize-y",
        error ? "border-[var(--red)]" : "border-[var(--hair)]",
        className,
      )}
      {...rest}
    />
  ),
);
Textarea.displayName = "Textarea";
