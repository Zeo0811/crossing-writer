import * as RadixSelect from "@radix-ui/react-select";
import { forwardRef, type ReactNode } from "react";
import { cn } from "./cn";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  placeholder?: string;
  options?: SelectOption[];
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  ({ value, defaultValue, onValueChange, placeholder, options, children, className, disabled, ...rest }, ref) => (
    <RadixSelect.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        ref={ref}
        aria-label={rest["aria-label"]}
        className={cn(
          "inline-flex items-center justify-between gap-2 bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)] data-[placeholder]:text-[var(--faint)] disabled:opacity-50",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="text-[var(--faint)]">▾</RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[160px] rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-lg p-1 max-h-[300px] overflow-auto"
        >
          <RadixSelect.Viewport>
            {options
              ? options.map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </SelectItem>
                ))
              : children}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  ),
);
Select.displayName = "Select";

export const SelectItem = forwardRef<HTMLDivElement, { value: string; disabled?: boolean; children: ReactNode }>(
  ({ value, disabled, children }, ref) => (
    <RadixSelect.Item
      ref={ref}
      value={value}
      disabled={disabled}
      className="flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[var(--body)] cursor-pointer outline-none data-[highlighted]:bg-[var(--bg-2)] data-[state=checked]:text-[var(--accent)] data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  ),
);
SelectItem.displayName = "SelectItem";
