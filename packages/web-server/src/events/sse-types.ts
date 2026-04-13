export type Sp03OverviewEventType =
  | "overview.started"
  | "overview.completed"
  | "overview.failed";

export type Sp03CaseEventType =
  | "case_expert.round1_started"
  | "case_expert.round1_completed"
  | "case_expert.tool_call"
  | "case_expert.round2_started"
  | "case_expert.round2_completed"
  | "case_expert.failed"
  | "case_coordinator.synthesizing"
  | "case_coordinator.done"
  | "cases.selected";

export type Sp03EventType = Sp03OverviewEventType | Sp03CaseEventType;
