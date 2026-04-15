export function SectionTitle({ index, label, action }: { index?: number; label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pb-1">
      {index != null && (
        <span
          className="text-[10px] tracking-[1.5px] text-[var(--accent)] font-bold tabular-nums"
          style={{ fontFamily: "var(--font-pixel)" }}
        >
          {String(index).padStart(2, "0")}
        </span>
      )}
      <h2 className="text-[15px] text-[var(--heading)] font-semibold whitespace-nowrap">{label}</h2>
      <span className="flex-1 h-px bg-[var(--hair)]" />
      {action}
    </div>
  );
}
