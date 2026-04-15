export function MockPlaceholder({ checkpoint, label }: { checkpoint: number; label: string }) {
  return (
    <div className="p-12 max-w-[720px] mx-auto text-center">
      <div
        className="text-[10px] tracking-[3px] text-[var(--meta)] mb-3"
        style={{ fontFamily: "var(--font-pixel)" }}
      >
        CHECKPOINT {String(checkpoint).padStart(2, "0")}
      </div>
      <h2 className="text-2xl text-[var(--heading)] mb-2">{label}</h2>
      <p className="text-sm text-[var(--meta)]">本页 mockup 将在 Checkpoint {checkpoint} 阶段长出来。</p>
    </div>
  );
}
