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
    const row: AggRow = map.get(a) ?? {
      agent: a,
      cli, model,
      state: "online",
      firstTs: String(ev.ts ?? ""),
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
  if (state === "online") return "inline-block w-2 h-2 bg-accent";
  if (state === "failed") return "inline-block w-2 h-2 bg-red";
  return "inline-block w-2 h-2 bg-hair-strong";
}

const TOOL_EVENT_TYPES = new Set([
  "writer.tool_called",
  "writer.tool_returned",
  "writer.tool_failed",
  "writer.tool_round_completed",
  "writer.selection_rewritten",
]);

function truncate(s: unknown, n = 30): string {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.length > n ? str.slice(0, n) + "…" : str;
}

function renderToolEvent(ev: StreamEvent, i: number) {
  const p = (ev.payload ?? ev.data ?? {}) as any;
  switch (ev.type) {
    case "writer.tool_called":
      return (
        <li key={`tool-${i}`} className="text-xs text-sky-700">
          🔧 [{p.sectionKey}·r{p.round}] → {p.toolName}({JSON.stringify(p.args ?? {})})
        </li>
      );
    case "writer.tool_returned":
      return (
        <li key={`tool-${i}`} className="text-xs text-emerald-700">
          ✅ [{p.sectionKey}·r{p.round}] ← {p.toolName} {p.ok ? "ok" : "fail"}
        </li>
      );
    case "writer.tool_failed":
      return (
        <li key={`tool-${i}`} className="text-xs text-red-600">
          ❌ [{p.sectionKey}·r{p.round}] ✗ {p.toolName}: {p.error}
        </li>
      );
    case "writer.tool_round_completed":
      return (
        <li key={`tool-${i}`} className="text-xs text-slate-500">
          ⟳ [{p.sectionKey}] round {p.round} 完成
        </li>
      );
    case "writer.selection_rewritten":
      return (
        <li key={`tool-${i}`} className="text-xs text-violet-700">
          ✂️ 改写选中片段 [{p.sectionKey}] {truncate(p.selected_text)} → {truncate(p.new_text)}
        </li>
      );
    default:
      return null;
  }
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
  const toolEvents = events.filter((e) => TOOL_EVENT_TYPES.has(e.type));
  return (
    <div className="border border-hair rounded-[6px] bg-[var(--log-bg)]">
      <div className="px-3 py-2 border-b border-hair bg-bg-2 text-xs font-semibold flex items-center justify-between text-body">
        <span className="flex items-center gap-2">
            <span className="font-pixel text-[11px] tracking-[0.06em] text-accent">[TIMELINE]</span>
            Agent 时间线
            {connectionState && (
              <SseHealthDot connectionState={connectionState} lastEventTs={lastEventTs ?? null} />
            )}
          </span>
        <span className="text-meta font-normal font-mono-term">
          {rows.length} agents · {events.length} events
        </span>
      </div>
      {rows.length === 0 && events.length === 0 ? (
        <div className="px-3 py-4 text-xs text-faint font-mono-term">
          暂无事件（等待 agent 启动…）
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="text-xs font-mono-term px-3 py-2 space-y-1 border-b border-hair">
              {rows.map((r) => (
                <li key={r.agent} data-testid={`agent-row-${r.agent}`} className="flex gap-2 items-center">
                  <span className="text-faint w-16">{r.firstTs.slice(11, 19)}</span>
                  <span className={dotClass(r.state)}
                    data-testid={`status-dot-${r.agent}`} />
                  <span className="truncate max-w-[12rem] text-body" title={r.agent}>{r.agent}</span>
                  <span className="text-meta">· {r.cli}/{r.model ?? "?"}</span>
                  <span className="ml-auto text-faint">{r.lastStage}</span>
                </li>
              ))}
            </ul>
          )}
          {toolEvents.length > 0 && (
            <ul data-testid="tool-events" className="px-3 py-2 space-y-1 border-b border-hair">
              {toolEvents.map((ev, i) => renderToolEvent(ev, i))}
            </ul>
          )}
          <details className="px-3 py-1">
            <summary className="cursor-pointer text-[10px] text-meta">
              原始事件 ({events.length})
            </summary>
            <ul className="text-[10px] font-mono-term space-y-0.5 mt-1 max-h-32 overflow-auto">
              {recent.map((ev, i) => (
                <li key={i} className="text-meta truncate" title={JSON.stringify(ev)}>
                  {typeof ev.ts === "string" ? ev.ts.slice(11, 19) : ev.ts} · {ev.type}
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
