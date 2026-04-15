import { useMock } from "../MockProvider";

export function MockToastHost() {
  const { toasts, dismissToast } = useMock();
  return (
    <div className="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-[360px]">
      {toasts.map((t) => {
        const icon = t.type === "success" ? "✓" : t.type === "error" ? "✗" : "ⓘ";
        const accent =
          t.type === "success" ? "var(--accent)" : t.type === "error" ? "var(--red)" : "var(--amber)";
        return (
          <div
            key={t.id}
            className="flex items-start gap-2 px-3 py-2 rounded border bg-[var(--bg-1)] text-sm shadow-lg"
            style={{ borderColor: accent }}
          >
            <span style={{ color: accent }}>{icon}</span>
            <span className="flex-1 text-[var(--body)]">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-[var(--faint)] hover:text-[var(--heading)] text-xs"
              aria-label="dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
