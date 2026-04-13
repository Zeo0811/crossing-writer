export type ProjectStatus =
  | "created"
  | "brief_uploaded"
  | "brief_analyzing"
  | "brief_ready"
  | "awaiting_expert_selection"
  | "round1_running"
  | "round1_failed"
  | "synthesizing"
  | "round2_running"
  | "round2_failed"
  | "awaiting_mission_pick"
  | "mission_approved"
  | "overview_analyzing"
  | "overview_ready"
  | "overview_failed";

export type ProjectStage = "intake" | "mission" | "completed";

const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
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
  mission_approved: [],
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
