import * as RadixDialog from "@radix-ui/react-dialog";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "./cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogPortal = RadixDialog.Portal;
export const DialogClose = RadixDialog.Close;

export const DialogOverlay = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RadixDialog.Overlay>>(
  ({ className, ...rest }, ref) => (
    <RadixDialog.Overlay
      ref={ref}
      className={cn("fixed inset-0 z-40 bg-[rgba(0,0,0,0.55)] backdrop-blur-sm", className)}
      {...rest}
    />
  ),
);
DialogOverlay.displayName = "DialogOverlay";

export interface DialogContentProps extends ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  width?: number | string;
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, width = 440, children, ...rest }, ref) => (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[95vw] max-h-[90vh] rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-2xl overflow-hidden flex flex-col",
          className,
        )}
        style={{ width }}
        {...rest}
      >
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  ),
);
DialogContent.displayName = "DialogContent";

export function DialogHeader({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div className="px-4 h-12 border-b border-[var(--hair)] flex items-center justify-between">
      <RadixDialog.Title className="text-base font-semibold text-[var(--heading)] m-0">{title}</RadixDialog.Title>
      {onClose && (
        <RadixDialog.Close
          aria-label="close"
          onClick={onClose}
          className="text-[var(--meta)] hover:text-[var(--heading)]"
        >
          ✕
        </RadixDialog.Close>
      )}
    </div>
  );
}

export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-4 overflow-y-auto flex-1", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 py-3 border-t border-[var(--hair)] flex items-center justify-end gap-2", className)}>
      {children}
    </div>
  );
}
