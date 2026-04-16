import * as RadixRadio from "@radix-ui/react-radio-group";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export const RadioGroup = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixRadio.Root>>(
  ({ className, ...rest }, ref) => (
    <RadixRadio.Root ref={ref} className={cn("flex flex-col gap-2", className)} {...rest} />
  ),
);
RadioGroup.displayName = "RadioGroup";

export const RadioItem = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof RadixRadio.Item>>(
  ({ className, ...rest }, ref) => (
    <RadixRadio.Item
      ref={ref}
      className={cn(
        "w-4 h-4 rounded-full border border-[var(--hair-strong)] bg-[var(--bg-1)] flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] data-[state=checked]:border-[var(--accent)] disabled:opacity-50",
        className,
      )}
      {...rest}
    >
      <RadixRadio.Indicator className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
    </RadixRadio.Item>
  ),
);
RadioItem.displayName = "RadioItem";
