import type { ActiveAgent } from "../../hooks/useProjectStream";

export function AgentStatusBar({ activeAgents }: { activeAgents: ActiveAgent[] }) {
  if (activeAgents.length === 0) return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-[var(--meta)]">活跃:</span>
      {activeAgents.map((a) => (
        <span key={a.agent} data-testid={`pill-${a.agent}`}
          title={`${a.agent} · ${a.cli}/${a.model} · ${a.stage}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--accent-fill)] border border-[var(--accent-soft)]">
          <span data-testid={`pulse-dot-${a.agent}`}
            className="w-1.5 h-1.5 rounded-full bg-[var(--accent-fill)]0 animate-pulse" />
          {a.agent} <span className="text-[var(--meta)]">{a.cli}</span>
        </span>
      ))}
    </div>
  );
}
