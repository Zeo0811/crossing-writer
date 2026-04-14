import { useEffect, useRef } from "react";
import type { IngestStreamEvent } from "../../api/wiki-client";

export interface IngestProgressViewProps {
  events: IngestStreamEvent[];
  status: "idle" | "running" | "done" | "error";
  error: string | null;
}

function fmt(e: IngestStreamEvent): string {
  const ts = new Date().toISOString().slice(11, 19);
  switch (e.type) {
    case "batch_started":
      return `[${ts}] BATCH ${(e.batchIndex ?? 0) + 1}/${e.totalBatches ?? "?"} START account=${e.account ?? "?"}`;
    case "batch_completed":
      return `[${ts}] BATCH ${(e.batchIndex ?? 0) + 1} COMPLETE (${e.duration_ms ?? 0}ms) ${JSON.stringify(e.stats ?? {})}`;
    case "batch_failed":
      return `[${ts}] BATCH ${(e.batchIndex ?? 0) + 1} FAILED: ${e.error ?? ""}`;
    case "op_applied":
      return `[${ts}] OP ${e.op ?? "?"} ${e.path ?? ""}${e.error ? ` ERROR=${e.error}` : ""}`;
    case "account_completed":
      return `[${ts}] ACCOUNT DONE account=${e.account ?? "?"} ${JSON.stringify(e.stats ?? {})}`;
    case "all_completed":
      return `[${ts}] ALL DONE ${JSON.stringify(e.stats ?? {})}`;
    default:
      return `[${ts}] ${e.type} ${JSON.stringify(e)}`;
  }
}

export function IngestProgressView({ events, status, error }: IngestProgressViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [events.length]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-gray-500" data-testid="ingest-status">State: {status === "done" ? "finished" : status}</div>
      {error && (
        <div className="bg-red-100 text-red-800 p-2 rounded text-sm">
          {error}
        </div>
      )}
      <div
        ref={boxRef}
        className="bg-black text-green-400 font-mono text-xs p-3 rounded overflow-auto whitespace-pre-wrap"
        style={{ height: 360 }}
      >
        {events.map((e, i) => (
          <div key={i}>{fmt(e)}</div>
        ))}
      </div>
    </div>
  );
}
