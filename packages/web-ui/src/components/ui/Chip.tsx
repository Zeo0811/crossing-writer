import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const chipVariants = cva("inline-flex items-center gap-1 rounded-sm font-medium whitespace-nowrap", {
  variants: {
    variant: {
      neutral: "",
      accent: "",
      amber: "",
      red: "",
      pink: "",
    },
    tone: {
      solid: "",
      soft: "",
    },
    size: {
      sm: "h-5 px-1.5 text-[10px]",
      md: "h-6 px-2 text-[11px]",
    },
  },
  compoundVariants: [
    { variant: "neutral", tone: "soft", className: "bg-[var(--bg-2)] text-[var(--meta)]" },
    { variant: "neutral", tone: "solid", className: "bg-[var(--hair-strong)] text-[var(--heading)]" },
    { variant: "accent", tone: "soft", className: "bg-[var(--accent-fill)] text-[var(--accent)]" },
    { variant: "accent", tone: "solid", className: "bg-[var(--accent)] text-[var(--accent-on)]" },
    { variant: "amber", tone: "soft", className: "bg-[var(--amber-bg)] text-[var(--amber)]" },
    { variant: "amber", tone: "solid", className: "bg-[var(--amber)] text-[var(--accent-on)]" },
    { variant: "red", tone: "soft", className: "bg-[rgba(255,107,107,0.12)] text-[var(--red)]" },
    { variant: "red", tone: "solid", className: "bg-[var(--red)] text-white" },
    { variant: "pink", tone: "soft", className: "bg-[rgba(255,106,176,0.12)] text-[var(--pink)]" },
    { variant: "pink", tone: "solid", className: "bg-[var(--pink)] text-white" },
  ],
  defaultVariants: { variant: "neutral", tone: "soft", size: "md" },
});

export interface ChipProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {}

export const Chip = forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, variant, tone, size, ...rest }, ref) => (
    <span ref={ref} className={cn(chipVariants({ variant, tone, size }), className)} {...rest} />
  ),
);
Chip.displayName = "Chip";
