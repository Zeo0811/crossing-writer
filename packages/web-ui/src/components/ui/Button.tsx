import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]",
  {
    variants: {
      variant: {
        primary:
          "border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] hover:shadow-[0_0_12px_var(--accent-dim)]",
        secondary:
          "border border-[var(--hair-strong)] bg-[var(--bg-1)] text-[var(--body)] hover:text-[var(--heading)] hover:border-[var(--accent-soft)]",
        ghost:
          "bg-transparent text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]",
        danger:
          "border border-[var(--red)] bg-[var(--red)] text-white hover:shadow-[0_0_12px_rgba(255,107,107,0.4)]",
        link:
          "bg-transparent text-[var(--accent)] hover:underline px-0 py-0 h-auto",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-5 text-sm font-semibold",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, leftSlot, rightSlot, children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type={rest.type ?? "button"}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant, size }), className)}
        {...rest}
      >
        {loading ? <span className="animate-pulse">…</span> : leftSlot}
        {children}
        {rightSlot}
      </button>
    );
  },
);
Button.displayName = "Button";
