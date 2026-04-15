// Mirrors web-server/src/state/state-machine.ts STATUSES exactly.
export type HeroStatus =
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

export const HERO_STATUSES: { id: HeroStatus; label: string }[] = [
  { id: "created", label: "刚创建" },
  { id: "brief_uploaded", label: "简报已上传" },
  { id: "brief_analyzing", label: "简报解析中" },
  { id: "brief_ready", label: "简报就绪" },
  { id: "awaiting_expert_selection", label: "等待挑专家（选题）" },
  { id: "round1_running", label: "选题 · 第一轮思考" },
  { id: "round1_failed", label: "选题 · 第一轮失败" },
  { id: "synthesizing", label: "选题 · 综合中" },
  { id: "round2_running", label: "选题 · 第二轮收敛" },
  { id: "round2_failed", label: "选题 · 第二轮失败" },
  { id: "awaiting_mission_pick", label: "选题 · 候选待挑选" },
  { id: "mission_approved", label: "选题已选定" },
  { id: "awaiting_overview_input", label: "等待概览输入" },
  { id: "overview_analyzing", label: "产品概览生成中" },
  { id: "overview_ready", label: "产品概览就绪" },
  { id: "overview_failed", label: "产品概览失败" },
  { id: "awaiting_case_expert_selection", label: "等待挑专家（用例）" },
  { id: "case_planning_running", label: "用例规划中" },
  { id: "case_planning_failed", label: "用例规划失败" },
  { id: "case_synthesizing", label: "用例综合中" },
  { id: "awaiting_case_selection", label: "用例候选待挑选" },
  { id: "case_plan_approved", label: "用例已批准" },
  { id: "evidence_collecting", label: "实测收集中" },
  { id: "evidence_ready", label: "实测素材就绪" },
  { id: "writing_configuring", label: "写作配置" },
  { id: "writing_running", label: "写作生成中" },
  { id: "writing_ready", label: "初稿就绪" },
  { id: "writing_editing", label: "稿件编辑中" },
  { id: "writing_failed", label: "写作失败" },
];

export interface MockProject {
  id: string;
  name: string;
  status: HeroStatus;
  updated_at: string;
  product?: string;
  archived?: boolean;
}

export const HERO_PROJECT_ID = "cursor-ide-review";

export const mockProjects: MockProject[] = [
  { id: HERO_PROJECT_ID, name: "测评 Cursor IDE", status: "created", product: "Cursor", updated_at: "2026-04-15T10:30:00Z" },
  { id: "lovable-test", name: "Lovable 一周实测", status: "writing_ready", product: "Lovable", updated_at: "2026-04-14T22:11:00Z" },
  { id: "v0-vs-bolt", name: "v0 vs Bolt 横评", status: "evidence_collecting", product: "v0 / Bolt", updated_at: "2026-04-13T18:00:00Z" },
  { id: "perplexity-deep", name: "Perplexity Deep Research 体验", status: "writing_ready", product: "Perplexity", updated_at: "2026-04-10T09:00:00Z" },
  { id: "claude-code-vibe", name: "Claude Code 工作流", status: "awaiting_mission_pick", product: "Claude Code", updated_at: "2026-04-15T08:45:00Z" },
];
