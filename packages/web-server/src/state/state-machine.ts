export const STATUSES = [
  "created",
  "brief_uploaded",
  "brief_analyzing",
  "brief_ready",
  "awaiting_expert_selection",
  "round1_running",
  "round1_failed",
  "synthesizing",
  "round2_running",
  "round2_failed",
  "awaiting_mission_pick",
  "mission_approved",
  "overview_analyzing",
  "overview_ready",
  "overview_failed",
  "awaiting_overview_input",
  "awaiting_case_expert_selection",
  "case_planning_running",
  "case_planning_failed",
  "case_synthesizing",
  "awaiting_case_selection",
  "case_plan_approved",
  "evidence_collecting",
  "evidence_ready",
  "writing_configuring",
  "writing_running",
  "writing_ready",
  "writing_editing",
  "writing_failed",
] as const;

export type ProjectStatus = (typeof STATUSES)[number];

export type ProjectStage = "intake" | "mission" | "completed";

export const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  created: ["brief_uploaded"],
  brief_uploaded: ["brief_analyzing"],
  brief_analyzing: ["brief_ready", "brief_uploaded"],
  brief_ready: ["awaiting_expert_selection"],
  awaiting_expert_selection: ["round1_running"],
  round1_running: ["synthesizing", "round1_failed"],
  round1_failed: ["round1_running"],
  synthesizing: ["round2_running"],
  round2_running: ["awaiting_mission_pick", "round2_failed"],
  round2_failed: ["round2_running"],
  awaiting_mission_pick: ["mission_approved", "round1_running"],
  mission_approved: ["awaiting_overview_input"],
  awaiting_overview_input: ["overview_analyzing"],
  overview_analyzing: ["overview_ready", "overview_failed"],
  overview_ready: ["awaiting_case_expert_selection", "overview_analyzing"],
  overview_failed: ["overview_analyzing"],
  awaiting_case_expert_selection: ["case_planning_running"],
  case_planning_running: ["case_synthesizing", "case_planning_failed"],
  case_planning_failed: ["case_planning_running"],
  case_synthesizing: ["awaiting_case_selection"],
  awaiting_case_selection: ["case_plan_approved"],
  case_plan_approved: ["evidence_collecting"],
  evidence_collecting: ["evidence_ready"],
  evidence_ready: ["evidence_collecting", "writing_configuring"],
  writing_configuring: ["writing_running"],
  writing_running: ["writing_ready", "writing_failed"],
  writing_ready: ["writing_editing", "evidence_collecting"],
  writing_editing: ["writing_ready"],
  writing_failed: ["writing_running"],
};

export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function stageOf(status: ProjectStatus): ProjectStage {
  if (status === "mission_approved") return "completed";
  if (
    status === "created" ||
    status === "brief_uploaded" ||
    status === "brief_analyzing" ||
    status === "brief_ready"
  ) {
    return "intake";
  }
  return "mission";
}
