export interface MiniHeatmapProps { ingested: number; total: number }

export function MiniHeatmap({ ingested, total }: MiniHeatmapProps) {
  const pct = total > 0 ? Math.round((ingested / total) * 100) : 0;
  return (
    <div className="flex-1 h-1 rounded-full bg-[var(--bg-1)] overflow-hidden" data-testid="mini-heatmap">
      <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
    </div>
  );
}
