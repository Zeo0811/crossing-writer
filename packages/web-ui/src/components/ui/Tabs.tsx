import * as RadixTabs from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixTabs.List>>(
  ({ className, ...rest }, ref) => (
    <RadixTabs.List
      ref={ref}
      className={cn("flex items-center gap-1 border-b border-[var(--hair)]", className)}
      {...rest}
    />
  ),
);
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof RadixTabs.Trigger>>(
  ({ className, ...rest }, ref) => (
    <RadixTabs.Trigger
      ref={ref}
      className={cn(
        "px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors outline-none focus-visible:text-[var(--heading)] border-transparent text-[var(--meta)] hover:text-[var(--heading)] data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--heading)]",
        className,
      )}
      {...rest}
    />
  ),
);
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixTabs.Content>>(
  ({ className, ...rest }, ref) => (
    <RadixTabs.Content ref={ref} className={cn("outline-none", className)} {...rest} />
  ),
);
TabsContent.displayName = "TabsContent";
