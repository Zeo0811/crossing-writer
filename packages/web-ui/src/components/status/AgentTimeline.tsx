import type { StreamEvent } from "../../hooks/useProjectStream";

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
    const a = ev.agent;
    if (!a) continue;
    const row = map.get(a) ?? {
      agent: a,
      cli: ev.cli, model: ev.model,
      state: "online" as const,
      firstTs: ev.ts,
      lastStage: "",
      events: [],
    };
    row.events.push(ev);
    if (ev.cli) row.cli = ev.cli;
    if (ev.model !== undefined) row.model = ev.model;
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

export function AgentTimeline({ events }: { events: StreamEvent[] }) {
  const rows = aggregate(events);
  return (
    <ul className="text-xs font-mono space-y-1">
      {rows.map((r) => (
        <li key={r.agent} data-testid={`agent-row-${r.agent}`} className="flex gap-2">
          <span>{r.firstTs.slice(11, 19)}</span>
          <span className={dotClass(r.state)}
            data-testid={`status-dot-${r.agent}`} />
          <span>{r.agent}</span>
          <span className="text-gray-500">· {r.cli}/{r.model ?? "?"}</span>
          <span className="ml-auto text-gray-400">{r.lastStage}</span>
        </li>
      ))}
    </ul>
  );
}
