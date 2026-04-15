import { useEffect, useRef } from "react";
import type { IngestStreamEvent } from "../../api/wiki-client";

export interface IngestProgressViewProps {
  events: IngestStreamEvent[];
  status: "idle" | "running" | "done" | "error";
  error: string | null;
}

function fmt(e: IngestStreamEvent): { ts: string; tag: string; text: string; tone: "info" | "ok" | "err" } {
  const ts = new Date().toISOString().slice(11, 19);
  switch (e.type) {
    case "batch_started":
      return { ts, tag: "batch", text: `${(e.batchIndex ?? 0) + 1}/${e.totalBatches ?? "?"} 开始 · ${e.account ?? "?"}`, tone: "info" };
    case "batch_completed":
      return { ts, tag: "batch", text: `${(e.batchIndex ?? 0) + 1} 完成 · ${e.duration_ms ?? 0}ms · ${JSON.stringify(e.stats ?? {})}`, tone: "ok" };
    case "batch_failed":
      return { ts, tag: "batch", text: `${(e.batchIndex ?? 0) + 1} 失败：${e.error ?? ""}`, tone: "err" };
    case "op_applied":
      return { ts, tag: "op", text: `${e.op ?? "?"} ${e.path ?? ""}${e.error ? ` 错误=${e.error}` : ""}`, tone: e.error ? "err" : "info" };
    case "account_completed":
      return { ts, tag: "acc", text: `${e.account ?? "?"} 完成 · ${JSON.stringify(e.stats ?? {})}`, tone: "ok" };
    case "all_completed":
      return { ts, tag: "done", text: `全部完成 · ${JSON.stringify(e.stats ?? {})}`, tone: "ok" };
    default:
      return { ts, tag: (e as any).type ?? "?", text: JSON.stringify(e), tone: "info" };
  }
}

export function IngestProgressView({ events, status, error }: IngestProgressViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [events.length]);

  const statusLabel = status === "done" ? "已完成" : status === "running" ? "运行中" : status === "error" ? "失败" : "等待中";
  const statusColor =
    status === "done" ? "var(--accent)" :
    status === "running" ? "var(--amber)" :
    status === "error" ? "var(--red)" : "var(--faint)";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-xs text-[var(--meta)] font-semibold">入库状态</div>
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: statusColor }} data-testid="ingest-status">
          <span className={`w-1.5 h-1.5 rounded-full ${status === "running" ? "animate-pulse" : ""}`} style={{ background: statusColor }} />
          {statusLabel}
        </span>
        <span className="text-[10px] text-[var(--faint)] ml-auto">{events.length} 条事件</span>
      </div>

      {error && (
        <div className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-sm text-[var(--red)]">
          {error}
        </div>
      )}

      <div
        ref={boxRef}
        className="rounded bg-[var(--log-bg)] border border-[var(--hair)] overflow-auto"
        style={{ height: 360, fontFamily: "var(--font-mono)" }}
      >
        {events.length === 0 ? (
          <div className="p-6 text-center text-[var(--faint)] text-sm">尚未有事件。左侧表单填好后点「开始入库」。</div>
        ) : (
          <div className="p-3 space-y-0.5">
            {events.map((e, i) => {
              const { ts, tag, text, tone } = fmt(e);
              const color = tone === "ok" ? "var(--accent)" : tone === "err" ? "var(--red)" : "var(--meta)";
              return (
                <div key={i} className="flex gap-2 text-[11px] leading-relaxed">
                  <span className="text-[var(--faint)] shrink-0">[{ts}]</span>
                  <span className="shrink-0 w-12 text-right" style={{ color }}>{tag}</span>
                  <span className="text-[var(--body)] whitespace-pre-wrap break-all flex-1">{text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
