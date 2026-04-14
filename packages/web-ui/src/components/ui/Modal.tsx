import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="modal-overlay"
      data-modal-root=""
      onClick={onClose}
      className="fixed inset-0 bg-[rgba(0,0,0,0.55)] backdrop-blur-[6px] z-50 flex items-center justify-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="bg-bg-1 border border-hair rounded-[6px] min-w-[360px] max-w-[640px] w-[90vw] max-h-[85vh] overflow-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-hair">
          <h2 className="text-[15px] font-semibold text-heading m-0">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="bg-transparent border-0 text-meta hover:text-accent cursor-pointer text-[16px] leading-none"
          >
            ✕
          </button>
        </div>
        <div className="px-6 py-5 text-body text-[13px]">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-hair flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
}
