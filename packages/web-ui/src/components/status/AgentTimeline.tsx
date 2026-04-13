import type { ConnectionState, StreamEvent } from "../../hooks/useProjectStream";
import { SseHealthDot } from "./SseHealthDot";

interface AggRow {
  agent: string;
  cli?: string;
  model?: string | null;
  state: "online" | "done" | "failed";
  firstTs: string;
  lastStage: string;
  events: StreamEvent[];
}

function aggregate(events: StreamEvent[]): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const ev of events) {
    const d = (ev.data ?? {}) as any;
    const a = ev.agent ?? d.agent;
    if (!a) continue;
    const cli = ev.cli ?? d.cli;
    const model = ev.model ?? d.model;
    const row = map.get(a) ?? {
      agent: a,
      cli, model,
      state: "online" as const,
      firstTs: ev.ts,
      lastStage: "",
      events: [],
    };
    row.events.push(ev);
    if (cli) row.cli = cli;
    if (model !== undefined) row.model = model;
    if (/failed$/.test(ev.type)) row.state = "failed";
    else if (/(completed|done|ready)$/.test(ev.type)) row.state = "done";
    else if (/started|synthesizing|analyzing|generating/.test(ev.type)) row.state = "online";
    const stageMatch = ev.type.match(/\.([a-z_0-9]+)$/);
    if (stageMatch) row.lastStage = stageMatch[1]!;
    map.set(a, row);
  }
  return Array.from(map.values()).sort((a, b) => a.firstTs.localeCompare(b.firstTs));
}

function dotClass(state: AggRow["state"]): string {
  if (state === "online") return "inline-block w-2 h-2 rounded-full bg-green-500";
  if (state === "failed") return "inline-block w-2 h-2 rounded-full bg-red-500";
  return "inline-block w-2 h-2 rounded-full bg-gray-400";
}

export function AgentTimeline({
  events,
  connectionState,
  lastEventTs,
}: {
  events: StreamEvent[];
  connectionState?: ConnectionState;
  lastEventTs?: number | null;
}) {
  const rows = aggregate(events);
  const recent = events.slice(-20).reverse();
  return (
    <div className="border rounded bg-white">
      <div className="px-3 py-2 border-b bg-gray-50 text-xs font-semibold flex items-center justify-between">
        <span className="flex items-center gap-2">
            ⏱ Agent 时间线
            {connectionState && (
              <SseHealthDot connectionState={connectionState} lastEventTs={lastEventTs ?? null} />
            )}
          </span>
        <span className="text-gray-500 font-normal">
          {rows.length} agents · {events.length} events
        </span>
      </div>
      {rows.length === 0 && events.length === 0 ? (
        <div className="px-3 py-4 text-xs text-gray-400">
          暂无事件（等待 agent 启动…）
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="text-xs font-mono px-3 py-2 space-y-1 border-b">
              {rows.map((r) => (
                <li key={r.agent} data-testid={`agent-row-${r.agent}`} className="flex gap-2 items-center">
                  <span className="text-gray-500 w-16">{r.firstTs.slice(11, 19)}</span>
                  <span className={dotClass(r.state)}
                    data-testid={`status-dot-${r.agent}`} />
                  <span className="truncate max-w-[12rem]" title={r.agent}>{r.agent}</span>
                  <span className="text-gray-500">· {r.cli}/{r.model ?? "?"}</span>
                  <span className="ml-auto text-gray-400">{r.lastStage}</span>
                </li>
              ))}
            </ul>
          )}
          <details className="px-3 py-1">
            <summary className="cursor-pointer text-[10px] text-gray-500">
              原始事件 ({events.length})
            </summary>
            <ul className="text-[10px] font-mono space-y-0.5 mt-1 max-h-32 overflow-auto">
              {recent.map((ev, i) => (
                <li key={i} className="text-gray-600 truncate" title={JSON.stringify(ev)}>
                  {ev.ts?.slice(11, 19)} · {ev.type}
                  {ev.agent ? ` · ${ev.agent}` : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
