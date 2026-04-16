import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof RadixCheckbox.Root> {}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, ...rest }, ref) => (
    <RadixCheckbox.Root
      ref={ref}
      className={cn(
        "w-4 h-4 rounded-sm border border-[var(--hair-strong)] bg-[var(--bg-1)] flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] data-[state=checked]:bg-[var(--accent)] data-[state=checked]:border-[var(--accent)] disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      <RadixCheckbox.Indicator className="text-[var(--accent-on)] text-[10px] leading-none">✓</RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  ),
);
Checkbox.displayName = "Checkbox";
