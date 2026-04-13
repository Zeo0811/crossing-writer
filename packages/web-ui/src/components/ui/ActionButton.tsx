import { useState, type ReactNode } from "react";
import { useToast } from "./ToastProvider";

export interface ActionButtonProps {
  onClick: () => Promise<void>;
  children: ReactNode;
  successMsg?: string;
  errorMsg?: (e: unknown) => string;
  variant?: "primary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
  title?: string;
}

const variantClasses = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  ghost: "bg-transparent border border-gray-400 text-gray-700 hover:bg-gray-100 disabled:opacity-50",
};

const ERROR_ECHO_CLEAR_MS = 3000;

export function ActionButton({
  onClick, children, successMsg, errorMsg, variant = "primary",
  disabled, className, title,
}: ActionButtonProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [errorEcho, setErrorEcho] = useState<string | null>(null);

  async function handle() {
    if (loading) return;
    setLoading(true);
    setErrorEcho(null);
    try {
      await onClick();
      toast.success(successMsg ?? "操作成功");
    } catch (e) {
      const msg = errorMsg ? errorMsg(e) : String(e);
      toast.error(msg);
      setErrorEcho(msg);
      setTimeout(() => setErrorEcho(null), ERROR_ECHO_CLEAR_MS);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1 align-top">
      <button
        onClick={handle}
        disabled={loading || disabled}
        className={`px-3 py-1 rounded inline-flex items-center gap-2 ${variantClasses[variant]} ${className ?? ""}`}
        title={title}
      >
        {loading && (
          <span
            data-testid="action-spinner"
            className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"
          />
        )}
        {children}
      </button>
      {errorEcho && (
        <span data-testid="action-error-echo" className="text-xs text-red-600 max-w-xs">
          {errorEcho}
        </span>
      )}
    </div>
  );
}
