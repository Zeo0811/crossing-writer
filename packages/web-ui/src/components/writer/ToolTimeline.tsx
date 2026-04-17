export type TimelineEvent =
  | { kind: 'tool_called'; tool: string; args: Record<string, unknown>; ts: number }
  | { kind: 'tool_returned'; tool: string; hits_count: number; duration_ms: number; ts: number }
  | { kind: 'tool_round_completed'; round: number; total_tools: number; ts: number }
  | { kind: 'validation_passed'; attempt: number; chars: number; ts: number }
  | { kind: 'validation_retry'; violations: Array<Record<string, unknown>>; ts: number }
  | { kind: 'validation_failed'; violations: Array<Record<string, unknown>>; ts: number }
  | { kind: 'rewrite_completed'; ts: number };

export interface ToolTimelineProps {
  events: TimelineEvent[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function renderEvent(e: TimelineEvent): { icon: string; label: string; detail: string } {
  switch (e.kind) {
    case 'tool_called': {
      const argsStr = Object.entries(e.args)
        .map(([k, v]) => `${k}:${String(v)}`)
        .join(' ');
      return { icon: '🔧', label: `tool_called · ${e.tool}`, detail: argsStr || '—' };
    }
    case 'tool_returned':
      return { icon: '✓', label: `tool_returned · ${e.tool}`, detail: `${e.hits_count} hits · ${e.duration_ms}ms` };
    case 'tool_round_completed':
      return { icon: '◦', label: `round_completed`, detail: `round ${e.round} · ${e.total_tools} tools` };
    case 'validation_passed':
      return { icon: '✓', label: `validation_passed`, detail: `attempt ${e.attempt} · ${e.chars} 字` };
    case 'validation_retry':
      return { icon: '⚠', label: `validation_retry`, detail: `${e.violations.length} 违规 → retry` };
    case 'validation_failed':
      return { icon: '✗', label: `validation_failed`, detail: `${e.violations.length} 违规 保留` };
    case 'rewrite_completed':
      return { icon: '📝', label: `rewrite_completed`, detail: '' };
  }
}

export function ToolTimeline({ events }: ToolTimelineProps) {
  if (events.length === 0) {
    return <div className="text-xs text-[var(--faint)] italic">暂无活动</div>;
  }
  return (
    <ul className="space-y-1.5 text-xs font-mono" role="list">
      {events.map((e, i) => {
        const { icon, label, detail } = renderEvent(e);
        return (
          <li key={`${e.ts}-${i}`} role="listitem" className="flex items-start gap-2">
            <span className="text-[var(--meta)]">{formatTime(e.ts)}</span>
            <span className="text-[var(--accent)]">{icon}</span>
            <span className="text-[var(--body)]">{label}</span>
            {detail && <span className="text-[var(--meta)]">· {detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}
