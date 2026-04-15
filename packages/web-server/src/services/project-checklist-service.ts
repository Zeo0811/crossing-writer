import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectStore, Project } from "./project-store.js";
import type { AgentConfigStore, AgentStyleBinding, StyleBindingRole } from "./agent-config-store.js";
import type { ProjectOverrideStore } from "./project-override-store.js";
import type { StylePanelStore } from "./style-panel-store.js";
import { resolveStyleBinding, StyleNotBoundError } from "./style-binding-resolver.js";
import { ArticleStore } from "./article-store.js";

export type ChecklistStatus = "done" | "partial" | "blocked" | "todo" | "warning";

export type ChecklistStepId =
  | "brief"
  | "topic"
  | "case"
  | "evidence"
  | "styleBindings"
  | "draft"
  | "review";

export interface ChecklistItem {
  step: ChecklistStepId;
  status: ChecklistStatus;
  reason?: string;
  link?: string;
}

export interface ProjectChecklist {
  projectId: string;
  items: ChecklistItem[];
  generatedAt: string;
}

export interface ProjectChecklistServiceDeps {
  projectStore: ProjectStore;
  stylePanelStore: StylePanelStore;
  agentConfigStore: AgentConfigStore;
  projectOverrideStore: ProjectOverrideStore;
  projectsDir: string;
}

const WRITER_ROLES: StyleBindingRole[] = ["opening", "practice", "closing"];

export class ProjectChecklistService {
  constructor(private deps: ProjectChecklistServiceDeps) {}

  async build(projectId: string): Promise<ProjectChecklist | null> {
    const project = await this.deps.projectStore.get(projectId);
    if (!project) return null;
    const projectDir = this.deps.projectStore.projectDir(projectId);
    const items: ChecklistItem[] = [];
    items.push(this.computeBrief(project));
    items.push(this.computeTopic(project));
    items.push(this.computeCase(project));
    items.push(this.computeEvidence(project, projectDir));
    items.push(await this.computeStyleBindings(projectId));
    const draftItem = await this.computeDraft(projectDir);
    items.push(draftItem);
    items.push(this.computeReview(project, projectDir, draftItem));
    return { projectId, items, generatedAt: new Date().toISOString() };
  }

  private computeBrief(p: Project): ChecklistItem {
    if (!p.brief) {
      return { step: "brief", status: "todo", link: "brief", reason: "尚未上传 brief" };
    }
    if (!p.brief.md_path) {
      return {
        step: "brief",
        status: "warning",
        link: "brief",
        reason: "brief 上传但解析失败",
      };
    }
    if (p.status === "created") {
      return { step: "brief", status: "todo", link: "brief", reason: "尚未上传 brief" };
    }
    return { step: "brief", status: "done", link: "brief" };
  }

  private computeTopic(p: Project): ChecklistItem {
    if (p.mission?.selected_path) {
      return { step: "topic", status: "done", link: "mission" };
    }
    if (p.mission?.candidates_path) {
      return {
        step: "topic",
        status: "partial",
        link: "mission",
        reason: "有候选选题但尚未定稿",
      };
    }
    return { step: "topic", status: "todo", link: "mission" };
  }

  private computeCase(p: Project): ChecklistItem {
    const cp = (p as any).case_plan as
      | { status?: string; selected_path?: string | null; approved_at?: string | null }
      | undefined;
    if (!cp) return { step: "case", status: "todo", link: "case" };
    if (cp.status === "finalized" || cp.approved_at) {
      return { step: "case", status: "done", link: "case" };
    }
    if (cp.status === "draft") {
      return {
        step: "case",
        status: "partial",
        link: "case",
        reason: "案例策划仍为 draft 状态",
      };
    }
    if (cp.selected_path) {
      return { step: "case", status: "done", link: "case" };
    }
    return { step: "case", status: "partial", link: "case", reason: "案例策划仍为 draft 状态" };
  }

  private computeEvidence(p: Project, projectDir: string): ChecklistItem {
    const flags = (p as any).flags as { evidence_skipped?: boolean } | undefined;
    if (flags?.evidence_skipped === true) {
      return { step: "evidence", status: "done", link: "evidence" };
    }
    const evDir = join(projectDir, "evidence");
    if (existsSync(evDir)) {
      try {
        const entries = readdirSync(evDir);
        if (entries.length > 0) {
          return { step: "evidence", status: "done", link: "evidence" };
        }
      } catch {
        // fallthrough
      }
    }
    if (p.evidence && p.evidence.all_complete) {
      return { step: "evidence", status: "done", link: "evidence" };
    }
    return {
      step: "evidence",
      status: "todo",
      link: "evidence",
      reason: "尚未上传素材，也未标记「不需要」",
    };
  }

  private resolveBinding(projectId: string, agentKey: string): AgentStyleBinding | undefined {
    const override = this.deps.projectOverrideStore.get(projectId);
    const overrideEntry = override?.agents?.[agentKey];
    if (overrideEntry && (overrideEntry as any).styleBinding) {
      return (overrideEntry as any).styleBinding as AgentStyleBinding;
    }
    const global = this.deps.agentConfigStore.get(agentKey);
    return global?.styleBinding;
  }

  private async computeStyleBindings(projectId: string): Promise<ChecklistItem> {
    for (const role of WRITER_ROLES) {
      const agentKey = `writer.${role}`;
      const binding = this.resolveBinding(projectId, agentKey);
      if (!binding) {
        return {
          step: "styleBindings",
          status: "blocked",
          link: "config",
          reason: `${agentKey} 缺少 styleBinding（missing）`,
        };
      }
      try {
        const resolved = await resolveStyleBinding(binding, this.deps.stylePanelStore);
        if (!resolved) {
          return {
            step: "styleBindings",
            status: "blocked",
            link: "config",
            reason: `${agentKey} 缺少 styleBinding（missing）`,
          };
        }
      } catch (err) {
        if (err instanceof StyleNotBoundError) {
          return {
            step: "styleBindings",
            status: "blocked",
            link: "config",
            reason: `${agentKey} 缺少 styleBinding（${err.reason}）`,
          };
        }
        throw err;
      }
    }
    return { step: "styleBindings", status: "done", link: "config" };
  }

  private async computeDraft(projectDir: string): Promise<ChecklistItem> {
    const store = new ArticleStore(projectDir);
    let count = 0;
    const sections = await store.listSections();
    // opening
    const hasOpening = sections.some((s) => s.key === "opening" && s.body.trim().length > 0);
    // practice: at least one practice.case-* non-empty
    const hasPractice = sections.some(
      (s) => typeof s.key === "string" && s.key.startsWith("practice.case-") && s.body.trim().length > 0,
    );
    const hasClosing = sections.some((s) => s.key === "closing" && s.body.trim().length > 0);
    if (hasOpening) count++;
    if (hasPractice) count++;
    if (hasClosing) count++;
    if (count === 3) return { step: "draft", status: "done", link: "article" };
    if (count === 0) return { step: "draft", status: "todo", link: "article" };
    return {
      step: "draft",
      status: "partial",
      link: "article",
      reason: `${count}/3 section 有初稿`,
    };
  }

  private computeReview(
    p: Project,
    projectDir: string,
    draftItem: ChecklistItem,
  ): ChecklistItem {
    const review = (p as any).review as { passed?: boolean } | undefined;
    const reportPath = join(projectDir, "style_critic_report.json");
    if (review?.passed === true || existsSync(reportPath)) {
      return { step: "review", status: "done", link: "article" };
    }
    if (draftItem.status === "done") {
      return {
        step: "review",
        status: "warning",
        link: "article",
        reason: "style-critic 未跑",
      };
    }
    return { step: "review", status: "todo", link: "article" };
  }
}
