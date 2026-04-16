import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export const Menu = RadixMenu.Root;
export const MenuTrigger = RadixMenu.Trigger;

export const MenuContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixMenu.Content>>(
  ({ className, sideOffset = 4, ...rest }, ref) => (
    <RadixMenu.Portal>
      <RadixMenu.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[160px] rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-lg p-1",
          className,
        )}
        {...rest}
      />
    </RadixMenu.Portal>
  ),
);
MenuContent.displayName = "MenuContent";

export interface MenuItemProps extends ComponentPropsWithoutRef<typeof RadixMenu.Item> {
  danger?: boolean;
}

export const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(
  ({ className, danger, ...rest }, ref) => (
    <RadixMenu.Item
      ref={ref}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded text-xs outline-none cursor-pointer",
        danger
          ? "text-[var(--red)] data-[highlighted]:bg-[rgba(255,107,107,0.1)]"
          : "text-[var(--body)] data-[highlighted]:bg-[var(--bg-2)]",
        className,
      )}
      {...rest}
    />
  ),
);
MenuItem.displayName = "MenuItem";

export const MenuSeparator = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixMenu.Separator>>(
  ({ className, ...rest }, ref) => (
    <RadixMenu.Separator ref={ref} className={cn("my-1 h-px bg-[var(--hair)]", className)} {...rest} />
  ),
);
MenuSeparator.displayName = "MenuSeparator";
