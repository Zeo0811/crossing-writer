export type HeroStatus =
  | "draft"
  | "brief_uploading"
  | "brief_uploaded"
  | "brief_ready"
  | "mission_picking"
  | "mission_running"
  | "overview_ready"
  | "case_planning"
  | "case_plan_approved"
  | "evidence_collecting"
  | "evidence_ready"
  | "writing"
  | "writing_ready"
  | "reviewing"
  | "published";

export const HERO_STATUSES: { id: HeroStatus; label: string }[] = [
  { id: "draft", label: "草稿" },
  { id: "brief_uploading", label: "Brief 上传中" },
  { id: "brief_uploaded", label: "Brief 已上传" },
  { id: "brief_ready", label: "Brief 解析就绪" },
  { id: "mission_picking", label: "选题候选" },
  { id: "mission_running", label: "选题生成中" },
  { id: "overview_ready", label: "产品概览就绪" },
  { id: "case_planning", label: "Case 规划中" },
  { id: "case_plan_approved", label: "Case 已批准" },
  { id: "evidence_collecting", label: "Evidence 收集" },
  { id: "evidence_ready", label: "Evidence 就绪" },
  { id: "writing", label: "写作中" },
  { id: "writing_ready", label: "初稿就绪" },
  { id: "reviewing", label: "审稿" },
  { id: "published", label: "已发布" },
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
  { id: HERO_PROJECT_ID, name: "测评 Cursor IDE", status: "draft", product: "Cursor", updated_at: "2026-04-15T10:30:00Z" },
  { id: "lovable-test", name: "Lovable 一周实测", status: "writing", product: "Lovable", updated_at: "2026-04-14T22:11:00Z" },
  { id: "v0-vs-bolt", name: "v0 vs Bolt 横评", status: "evidence_collecting", product: "v0 / Bolt", updated_at: "2026-04-13T18:00:00Z" },
  { id: "perplexity-deep", name: "Perplexity Deep Research 体验", status: "published", product: "Perplexity", updated_at: "2026-04-10T09:00:00Z" },
  { id: "claude-code-vibe", name: "Claude Code 工作流", status: "mission_picking", product: "Claude Code", updated_at: "2026-04-15T08:45:00Z" },
];
