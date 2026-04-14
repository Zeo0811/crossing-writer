interface ProgressBarProps {
  value: number;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({ value, showLabel = true, className = "" }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <div
        className="flex-1 h-1 bg-hair rounded-[2px] overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div data-fill="" className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <span className="font-mono-term text-[11px] text-meta tabular-nums">{pct}%</span>
      )}
    </div>
  );
}
