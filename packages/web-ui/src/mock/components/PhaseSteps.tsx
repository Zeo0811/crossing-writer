import type { HeroStatus } from "../fixtures/projects";
import { PHASES, phaseIndexOf } from "../fixtures/phases";

export function PhaseSteps({ status }: { status: HeroStatus }) {
  const cur = phaseIndexOf(status);
  const isFailed = status.endsWith("_failed");
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PHASES.map((p, i) => {
        const state: "done" | "current" | "todo" =
          i < cur ? "done" : i === cur ? "current" : "todo";
        const isCurrent = state === "current";
        let cls =
          "inline-flex items-center gap-1.5 px-3 h-8 rounded text-xs leading-none border ";
        if (state === "done") cls += "border-[var(--accent-soft)] bg-[var(--accent-fill)] text-[var(--accent)]";
        else if (isCurrent && isFailed) cls += "border-[var(--red)] bg-[rgba(255,107,107,0.08)] text-[var(--red)]";
        else if (isCurrent) cls += "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold shadow-[0_0_10px_var(--accent-dim)]";
        else cls += "border-[var(--hair)] bg-transparent text-[var(--faint)]";
        return (
          <div key={p.id} className="flex items-center gap-1.5">
            <div className={`relative ${cls}`}>
              <span className="tabular-nums opacity-80">{String(i + 1).padStart(2, "0")}</span>
              <span>{p.label}</span>
              {state === "done" && <span className="text-[10px]">✓</span>}
              {isCurrent && !isFailed && <span className="w-1 h-1 rounded-full bg-[var(--accent-on)] animate-pulse" />}
              {isCurrent && (
                <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 flex flex-col items-center gap-[3px] z-10 pointer-events-none">
                  <span
                    className="w-3.5 h-[2px] rounded-sm phase-trail-bar phase-trail-1"
                    style={{ background: isFailed ? "var(--red)" : "var(--accent)" }}
                  />
                  <span
                    className="w-3 h-[2px] rounded-sm phase-trail-bar phase-trail-2"
                    style={{ background: isFailed ? "var(--red)" : "var(--accent)" }}
                  />
                  <span
                    className="w-2.5 h-[2px] rounded-sm phase-trail-bar phase-trail-3"
                    style={{ background: isFailed ? "var(--red)" : "var(--accent-soft)" }}
                  />
                  <span
                    className="w-2 h-[2px] rounded-sm phase-trail-bar phase-trail-4"
                    style={{ background: isFailed ? "var(--red)" : "var(--accent-soft)" }}
                  />
                </span>
              )}
            </div>
            {i < PHASES.length - 1 && (
              <span className={`text-[var(--faint)] text-xs ${i < cur ? "text-[var(--accent-soft)]" : ""}`}>›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
