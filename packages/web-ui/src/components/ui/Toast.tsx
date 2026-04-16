export type ToastType = "success" | "error" | "info";

export interface ToastData {
  id: number;
  type: ToastType;
  message: string;
}

const colors: Record<ToastType, string> = {
  success: "bg-[var(--accent-fill)] border-[var(--accent-soft)] text-[var(--accent)]",
  error: "bg-[rgba(255,107,107,0.08)] border-[var(--red)] text-[var(--red)]",
  info: "bg-[var(--bg-2)] border-[var(--hair)] text-[var(--heading)]",
};

export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  return (
    <div
      data-testid={`toast-${toast.type}`}
      className={`border rounded px-3 py-2 text-sm flex items-start gap-2 shadow-sm ${colors[toast.type]}`}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="text-xs opacity-60 hover:opacity-100"
        aria-label="close"
      >
        ×
      </button>
    </div>
  );
}
