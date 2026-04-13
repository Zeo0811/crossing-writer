export type ToastType = "success" | "error" | "info";

export interface ToastData {
  id: number;
  type: ToastType;
  message: string;
}

const colors: Record<ToastType, string> = {
  success: "bg-green-50 border-green-300 text-green-800",
  error: "bg-red-50 border-red-300 text-red-800",
  info: "bg-gray-50 border-gray-300 text-gray-800",
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
