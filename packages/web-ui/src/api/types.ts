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
  | "awaiting_overview_input"
  | "overview_analyzing"
  | "overview_ready"
  | "overview_failed"
  | "awaiting_case_expert_selection"
  | "case_planning_running"
  | "case_planning_failed"
  | "case_synthesizing"
  | "awaiting_case_selection"
  | "case_plan_approved"
  | "evidence_collecting"
  | "evidence_ready"
  | "writing_configuring"
  | "writing_running"
  | "writing_ready"
  | "writing_editing"
  | "writing_failed";

export type ProjectStage = "intake" | "mission" | "completed";

export interface Project {
  id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  stage: ProjectStage;
  article_type: string | null;
  experts_selected: string[];
  brief: null | {
    source_type: string;
    raw_path: string;
    md_path: string;
    summary_path: string | null;
    uploaded_at: string;
  };
  product_info: null | {
    name: string | null;
    official_url: string | null;
    trial_url: string | null;
    docs_url: string | null;
    fetched_path: string | null;
    notes: string | null;
  };
  mission: {
    candidates_path: string | null;
    selected_index: number | null;
    selected_path: string | null;
    selected_at: string | null;
    selected_by: string | null;
  };
  tags: string[];
  created_at: string;
  updated_at: string;
  archived?: boolean;
}

export interface ProjectListResponse {
  items: Project[];
  archived_count?: number;
  active_count?: number;
}

export interface Expert {
  name: string;
  file: string;
  active: boolean;
  default_preselect: boolean;
  specialty: string;
}

export interface ProjectImage {
  filename: string;
  source: "brief" | "screenshot";
  relPath: string;
  absPath: string;
  label?: string;
}

export interface OverviewGenerateBody {
  productUrls: string[];
  userDescription?: string;
}

export interface CaseExpertInfo {
  name: string;
  specialty: string;
  creativity_score: number | null;
  preselected: boolean;
}
