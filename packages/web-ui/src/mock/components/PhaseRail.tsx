import type { HeroStatus } from "../fixtures/projects";
import { PHASES, phaseIndexOf } from "../fixtures/phases";

export function PhaseRail({ status }: { status: HeroStatus }) {
  const cur = phaseIndexOf(status);
  const isFailed = status.endsWith("_failed");
  return (
    <div className="rounded bg-[var(--bg-2)] p-4">
      <div className="text-xs text-[var(--meta)] font-semibold mb-3">阶段</div>
      <ol className="space-y-1">
        {PHASES.map((p, i) => {
          const state: "done" | "current" | "todo" =
            i < cur ? "done" : i === cur ? "current" : "todo";
          return (
            <li key={p.id} className="flex items-center gap-3">
              <span
                className={`relative flex items-center justify-center w-6 h-6 rounded text-[10px] font-semibold ${
                  state === "done"
                    ? "bg-[var(--accent-fill)] text-[var(--accent)]"
                    : state === "current"
                    ? isFailed
                      ? "bg-[var(--red)] text-white"
                      : "bg-[var(--accent)] text-[var(--accent-on)] animate-pulse"
                    : "bg-[var(--bg-1)] text-[var(--faint)]"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={`text-sm flex-1 ${
                  state === "current"
                    ? isFailed
                      ? "text-[var(--red)] font-semibold"
                      : "text-[var(--heading)] font-semibold"
                    : state === "done"
                    ? "text-[var(--meta)]"
                    : "text-[var(--faint)]"
                }`}
              >
                {p.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
