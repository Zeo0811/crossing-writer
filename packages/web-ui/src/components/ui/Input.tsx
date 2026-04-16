import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, leftSlot, rightSlot, error, ...rest }, ref) => {
    if (leftSlot || rightSlot) {
      return (
        <div
          className={cn(
            "flex items-center gap-2 bg-[var(--bg-2)] border rounded px-3 focus-within:border-[var(--accent-soft)] transition-colors",
            error ? "border-[var(--red)]" : "border-[var(--hair)]",
            className,
          )}
        >
          {leftSlot && <span className="text-[var(--faint)] shrink-0">{leftSlot}</span>}
          <input
            ref={ref}
            className="flex-1 min-w-0 bg-transparent py-2 text-sm text-[var(--body)] outline-none placeholder:text-[var(--faint)]"
            {...rest}
          />
          {rightSlot && <span className="text-[var(--faint)] shrink-0">{rightSlot}</span>}
        </div>
      );
    }
    return (
      <input
        ref={ref}
        className={cn(
          "w-full bg-[var(--bg-2)] border rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)] placeholder:text-[var(--faint)]",
          error ? "border-[var(--red)]" : "border-[var(--hair)]",
          className,
        )}
        {...rest}
      />
    );
  },
);
Input.displayName = "Input";
