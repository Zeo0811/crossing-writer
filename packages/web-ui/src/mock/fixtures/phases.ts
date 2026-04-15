import type { HeroStatus } from "./projects";

export interface Phase {
  id: string;
  label: string;
  matches: HeroStatus[];
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

export function phaseIndexOf(status: HeroStatus): number {
  return PHASES.findIndex((p) => p.matches.includes(status));
}

export function phaseProgress(status: HeroStatus): { current: number; total: number } {
  return { current: phaseIndexOf(status), total: PHASES.length };
}

export function statusBadge(s: HeroStatus): { fg: string; bg: string; label: string } {
  const phaseIdx = phaseIndexOf(s);
  const phase = PHASES[phaseIdx];
  if (s === "created") return { fg: "var(--faint)", bg: "var(--bg-2)", label: "草稿" };
  if (s.endsWith("_failed")) return { fg: "var(--red)", bg: "rgba(255,107,107,0.12)", label: phase?.label + " 失败" };
  if (s === "writing_ready") return { fg: "var(--accent)", bg: "var(--accent-fill)", label: "初稿就绪" };
  if (phase?.id === "brief") return { fg: "var(--meta)", bg: "var(--bg-2)", label: "需求解析" };
  if (phase?.id === "mission") return { fg: "var(--amber)", bg: "var(--amber-bg)", label: "专家团选题" };
  if (phase?.id === "overview") return { fg: "var(--accent-soft)", bg: "var(--accent-fill)", label: "产品解析" };
  if (phase?.id === "case") return { fg: "var(--accent-soft)", bg: "var(--accent-fill)", label: "Case 建议" };
  if (phase?.id === "evidence") return { fg: "var(--pink)", bg: "rgba(255,106,176,0.12)", label: "制作 Case" };
  if (phase?.id === "writing") return { fg: "var(--amber)", bg: "var(--amber-bg)", label: "创作" };
  return { fg: "var(--meta)", bg: "var(--bg-2)", label: s };
}
