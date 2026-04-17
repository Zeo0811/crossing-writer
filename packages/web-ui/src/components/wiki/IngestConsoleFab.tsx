import { useState } from "react";
import { IngestProgressView } from "./IngestProgressView";
import type { IngestStreamEvent } from "../../api/wiki-client";

function ConsoleTerminalIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="5 9 9 12 5 15" />
      <line x1="12" y1="15" x2="17" y2="15" />
    </svg>
  );
}

export interface IngestConsoleFabProps {
  events: IngestStreamEvent[];
  status: "idle" | "running" | "done" | "error";
  error: string | null;
  onDismiss: () => void;
}

export function IngestConsoleFab({ events, status, error, onDismiss }: IngestConsoleFabProps) {
  const [open, setOpen] = useState(false);

  const running = status === "running";
  const failed = status === "error";
  const dotClass = running ? "bg-[var(--accent)] animate-pulse" : failed ? "bg-[var(--red)]" : "bg-[var(--accent)]";
  const borderClass = failed ? "border-[var(--red)]" : running ? "border-[var(--accent-soft)]" : "border-[var(--hair)]";
  const hoverClass = failed ? "hover:border-[var(--red)]" : "hover:border-[var(--accent-soft)]";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="ingest-console-fab"
        aria-label="入库控制台"
        title={`入库控制台 · ${events.length} 事件`}
        className={`fixed bottom-5 right-5 z-40 group inline-flex items-center justify-center w-12 h-12 rounded-full border ${borderClass} bg-[var(--bg-1)] text-[var(--meta)] shadow-[0_4px_12px_rgba(0,0,0,0.12)] ${hoverClass} hover:bg-[var(--bg-2)] hover:text-[var(--accent)] transition-colors`}
      >
        <ConsoleTerminalIcon />
        {(running || failed) && (
          <span
            className={`absolute top-1 right-1 w-2.5 h-2.5 rounded-full ${dotClass}`}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="入库控制台"
          className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-0)]"
        >
          <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)] bg-[var(--bg-1)]">
            <h1 className="text-sm font-semibold text-[var(--heading)]">入库控制台</h1>
            <div className="flex items-center gap-2">
              {status === "done" && (
                <button
                  type="button"
                  onClick={() => { onDismiss(); setOpen(false); }}
                  className="text-xs text-[var(--meta)] hover:text-[var(--heading)] px-2 py-1"
                >
                  清空日志
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
              >
                ✕
              </button>
            </div>
          </header>
          <div className="flex-1 overflow-auto p-6">
            <IngestProgressView events={events} status={status} error={error} />
          </div>
        </div>
      )}
    </>
  );
}
