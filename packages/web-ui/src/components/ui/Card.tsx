import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const cardVariants = cva("rounded", {
  variants: {
    variant: {
      outer: "border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden",
      nested: "bg-[var(--bg-2)]",
      ghost: "bg-transparent",
    },
    padding: {
      none: "",
      sm: "p-3",
      md: "p-4",
      lg: "p-[18px]",
    },
  },
  defaultVariants: { variant: "outer", padding: "none" },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...rest }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, padding }), className)} {...rest} />
  ),
);
Card.displayName = "Card";
