import type { ProjectStatus } from "../../api/types";

export interface Phase {
  id: string;
  label: string;
  matches: ProjectStatus[];
}

export const PHASES: Phase[] = [
  {
    id: "brief",
    label: "需求解析",
    matches: ["created", "brief_uploaded", "brief_analyzing", "brief_ready"],
  },
  {
    id: "mission",
    label: "专家团选题",
    matches: [
      "awaiting_expert_selection",
      "round1_running",
      "round1_failed",
      "synthesizing",
      "round2_running",
      "round2_failed",
      "awaiting_mission_pick",
      "mission_approved",
    ],
  },
  {
    id: "overview",
    label: "产品解析",
    matches: ["awaiting_overview_input", "overview_analyzing", "overview_ready", "overview_failed"],
  },
  {
    id: "case",
    label: "Case 建议",
    matches: [
      "awaiting_case_expert_selection",
      "case_planning_running",
      "case_planning_failed",
      "case_synthesizing",
      "awaiting_case_selection",
      "case_plan_approved",
    ],
  },
  {
    id: "evidence",
    label: "制作 Case",
    matches: ["evidence_collecting", "evidence_ready"],
  },
  {
    id: "writing",
    label: "创作",
    matches: ["writing_configuring", "writing_running", "writing_ready", "writing_editing", "writing_failed"],
  },
];

export function phaseIndexOf(status: ProjectStatus): number {
  return PHASES.findIndex((p) => p.matches.includes(status));
}

export function statusBadge(s: ProjectStatus | string): { fg: string; bg: string; label: string } {
  const phaseIdx = PHASES.findIndex((p) => p.matches.includes(s as ProjectStatus));
  const phase = PHASES[phaseIdx];
  if (s === "created") return { fg: "var(--faint)", bg: "var(--bg-2)", label: "草稿" };
  if (typeof s === "string" && s.endsWith("_failed")) return { fg: "var(--red)", bg: "rgba(255,107,107,0.12)", label: (phase?.label ?? "") + " 失败" };
  if (s === "writing_ready") return { fg: "var(--accent)", bg: "var(--accent-fill)", label: "初稿就绪" };
  if (phase?.id === "brief") return { fg: "var(--meta)", bg: "var(--bg-2)", label: "需求解析" };
  if (phase?.id === "mission") return { fg: "var(--amber)", bg: "var(--amber-bg)", label: "专家团选题" };
  if (phase?.id === "overview") return { fg: "var(--accent-soft)", bg: "var(--accent-fill)", label: "产品解析" };
  if (phase?.id === "case") return { fg: "var(--accent-soft)", bg: "var(--accent-fill)", label: "Case 建议" };
  if (phase?.id === "evidence") return { fg: "var(--pink)", bg: "rgba(255,106,176,0.12)", label: "制作 Case" };
  if (phase?.id === "writing") return { fg: "var(--amber)", bg: "var(--amber-bg)", label: "创作" };
  return { fg: "var(--meta)", bg: "var(--bg-2)", label: String(s) };
}

export function PhaseSteps({ status }: { status: ProjectStatus }) {
  const cur = phaseIndexOf(status);
  const isFailed = typeof status === "string" && status.endsWith("_failed");
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
              <span className="tabular-nums opacity-80" style={{ fontFamily: "var(--font-pixel)", fontSize: "10px" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{p.label}</span>
              {state === "done" && <span className="text-[10px]">✓</span>}
              {isCurrent && !isFailed && <span className="w-1 h-1 rounded-full bg-[var(--accent-on)] animate-pulse" />}
              {isCurrent && (
                <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 flex flex-col items-center gap-[3px] z-10 pointer-events-none">
                  {[14, 12, 10, 8].map((w, n) => (
                    <span
                      key={n}
                      className={`h-[2px] rounded-sm phase-trail-bar phase-trail-${n + 1}`}
                      style={{ width: w, background: isFailed ? "var(--red)" : n < 2 ? "var(--accent)" : "var(--accent-soft)" }}
                    />
                  ))}
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
