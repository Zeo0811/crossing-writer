import { join } from "node:path";
import type { ProjectStore } from "./project-store.js";
import type { ProjectOverrideStore } from "./project-override-store.js";
import type { StylePanelStore } from "./style-panel-store.js";
import type { AgentConfigStore, AgentConfigEntry } from "./agent-config-store.js";
import { ArticleStore, type ArticleSectionFile } from "./article-store.js";
import { resolveStyleBinding } from "./style-binding-resolver.js";
import { existsSync, readFileSync } from "node:fs";

/**
 * SP-19 ContextBundle — unified snapshot of project-scoped context prepended to
 * every agent invocation so that writer/rewrite/topic-expert routes share the
 * same view of the project.
 */
export interface ContextBundleStyleEntry {
  account: string;
  role: string;
  version: number;
  bodyExcerpt: string;
}

export interface ContextBundleSection {
  key: string;
  body: string;
  manually_edited: boolean;
  tools_used: unknown[];
}

export interface ContextBundle {
  projectId: string;
  builtAt: string;
  brief: {
    summary: string;
    topic?: string;
  };
  productContext?: string;
  sections: ContextBundleSection[];
  frontmatter: Record<string, Record<string, unknown>>;
  styles: {
    opening?: ContextBundleStyleEntry;
    practice?: ContextBundleStyleEntry;
    closing?: ContextBundleStyleEntry;
  };
  agents: Record<string, AgentConfigEntry>;
  recentEdits: Array<{ section: string; at: string; kind: string }>;
  recentToolUses: Array<{ section: string; tool: string; ts?: string; ok?: boolean }>;
  _truncated?: boolean;
  _tokensEstimated?: number;
}

export interface ContextBundleDeps {
  projectStore: ProjectStore;
  projectsDir: string;
  stylePanelStore: StylePanelStore;
  agentConfigStore: AgentConfigStore;
  projectOverrideStore: ProjectOverrideStore;
}

export type ContextBundlePick = keyof ContextBundle;

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

function emptyBundle(projectId: string): ContextBundle {
  return {
    projectId,
    builtAt: new Date().toISOString(),
    brief: { summary: "" },
    sections: [],
    frontmatter: {},
    styles: {},
    agents: {},
    recentEdits: [],
    recentToolUses: [],
  };
}

export function mergeAgentOverrides(
  base: Record<string, AgentConfigEntry>,
  override: Partial<Record<string, Partial<AgentConfigEntry>>> | undefined,
): Record<string, AgentConfigEntry> {
  if (!override) return { ...base };
  const out: Record<string, AgentConfigEntry> = { ...base };
  for (const [k, ov] of Object.entries(override)) {
    if (!ov) continue;
    const b = base[k] ?? { agentKey: k };
    const merged: AgentConfigEntry = {
      ...b,
      ...ov,
      agentKey: k,
    };
    if (ov.styleBinding) merged.styleBinding = { ...(b.styleBinding ?? {}), ...ov.styleBinding } as any;
    if (ov.tools) merged.tools = { ...(b.tools ?? {}), ...ov.tools };
    out[k] = merged;
  }
  return out;
}

export function estimateTokens(str: string): number {
  return Math.ceil((str?.length ?? 0) / 4);
}

export function renderContextBlock(bundle: Partial<ContextBundle>): string {
  // Deterministic, compact JSON-in-tag envelope. Consumed as literal system
  // prefix by writer/rewrite/topic-expert paths.
  const payload = JSON.stringify(bundle, null, 2);
  return `[Project Context]\n${payload}\n[/Project Context]`;
}

export class ContextBundleService {
  constructor(private deps: ContextBundleDeps) {}

  async build(projectId: string): Promise<ContextBundle> {
    const project = await this.deps.projectStore.get(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    const bundle = emptyBundle(projectId);
    const pDir = join(this.deps.projectsDir, projectId);

    // brief: summary from brief/brief.md file if exists
    const briefPath = join(pDir, "brief", "brief.md");
    if (existsSync(briefPath)) {
      try {
        bundle.brief.summary = readFileSync(briefPath, "utf-8");
      } catch {
        /* ignore */
      }
    }
    // selected topic decision: optional text from mission/selected.md
    const missionSelectedPath = join(pDir, "mission", "selected.md");
    if (existsSync(missionSelectedPath)) {
      try {
        bundle.brief.topic = readFileSync(missionSelectedPath, "utf-8");
      } catch {
        /* ignore */
      }
    }

    // productContext
    const productOverviewPath = join(pDir, "context", "product-overview.md");
    if (existsSync(productOverviewPath)) {
      try {
        bundle.productContext = readFileSync(productOverviewPath, "utf-8");
      } catch {
        /* ignore */
      }
    }

    // sections + frontmatter
    const articleStore = new ArticleStore(pDir);
    let sections: ArticleSectionFile[] = [];
    try {
      sections = await articleStore.listSections();
    } catch {
      sections = [];
    }
    const recentEdits: ContextBundle["recentEdits"] = [];
    const recentToolUses: ContextBundle["recentToolUses"] = [];
    for (const s of sections) {
      const fm = s.frontmatter ?? ({} as Record<string, unknown>);
      bundle.sections.push({
        key: s.key,
        body: s.body,
        manually_edited: Boolean((fm as any).manually_edited),
        tools_used: Array.isArray((fm as any).tools_used) ? ((fm as any).tools_used as unknown[]) : [],
      });
      bundle.frontmatter[s.key] = fm as any;
      if ((fm as any).last_updated_at) {
        recentEdits.push({
          section: s.key,
          at: String((fm as any).last_updated_at),
          kind: (fm as any).manually_edited ? "manual" : "agent",
        });
      }
      const tools = Array.isArray((fm as any).tools_used) ? ((fm as any).tools_used as any[]) : [];
      for (const t of tools) {
        recentToolUses.push({
          section: s.key,
          tool: String(t?.tool ?? t?.name ?? "unknown"),
          ts: t?.ts ?? t?.at,
          ok: t?.ok,
        });
      }
    }
    recentEdits.sort((a, b) => (a.at < b.at ? 1 : -1));
    bundle.recentEdits = recentEdits.slice(0, 10);
    bundle.recentToolUses = recentToolUses.slice(-20);

    // agents: merge global + override
    const base = this.deps.agentConfigStore.getAll();
    const override = this.deps.projectOverrideStore.get(projectId);
    bundle.agents = mergeAgentOverrides(base, override?.agents);

    // styles: resolve per-role binding from merged agents
    const roles: Array<{ slot: "opening" | "practice" | "closing"; agentKey: string }> = [
      { slot: "opening", agentKey: "writer.opening" },
      { slot: "practice", agentKey: "writer.practice" },
      { slot: "closing", agentKey: "writer.closing" },
    ];
    for (const r of roles) {
      const cfg = bundle.agents[r.agentKey];
      if (!cfg?.styleBinding) continue;
      try {
        const resolved = await resolveStyleBinding(cfg.styleBinding, this.deps.stylePanelStore);
        if (!resolved) continue;
        bundle.styles[r.slot] = {
          account: resolved.panel.frontmatter.account,
          role: resolved.panel.frontmatter.role,
          version: resolved.panel.frontmatter.version,
          bodyExcerpt: resolved.bodyContent.slice(0, 600),
        };
      } catch {
        /* unresolved — leave slot undefined */
      }
    }

    bundle._tokensEstimated = estimateTokens(JSON.stringify(bundle));
    return bundle;
  }

  async buildLite(
    projectId: string,
    pick: readonly ContextBundlePick[],
  ): Promise<Partial<ContextBundle>> {
    const picks = new Set<ContextBundlePick>(pick);
    const project = await this.deps.projectStore.get(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const out: Partial<ContextBundle> = {
      projectId,
      builtAt: new Date().toISOString(),
    };
    const pDir = join(this.deps.projectsDir, projectId);

    if (picks.has("brief")) {
      const summary = existsSync(join(pDir, "brief", "brief.md"))
        ? readFileSync(join(pDir, "brief", "brief.md"), "utf-8")
        : "";
      const topicPath = join(pDir, "mission", "selected.md");
      out.brief = {
        summary,
        ...(existsSync(topicPath) ? { topic: readFileSync(topicPath, "utf-8") } : {}),
      };
    }
    if (picks.has("productContext")) {
      const p = join(pDir, "context", "product-overview.md");
      if (existsSync(p)) out.productContext = readFileSync(p, "utf-8");
    }
    if (picks.has("sections") || picks.has("frontmatter")) {
      const articleStore = new ArticleStore(pDir);
      const sections = await articleStore.listSections().catch(() => []);
      if (picks.has("sections")) {
        out.sections = sections.map((s) => ({
          key: s.key,
          body: s.body,
          manually_edited: Boolean((s.frontmatter as any).manually_edited),
          tools_used: Array.isArray((s.frontmatter as any).tools_used)
            ? ((s.frontmatter as any).tools_used as unknown[])
            : [],
        }));
      }
      if (picks.has("frontmatter")) {
        const fm: Record<string, Record<string, unknown>> = {};
        for (const s of sections) fm[s.key] = s.frontmatter as any;
        out.frontmatter = fm;
      }
    }
    if (picks.has("agents") || picks.has("styles")) {
      const base = this.deps.agentConfigStore.getAll();
      const override = this.deps.projectOverrideStore.get(projectId);
      const merged = mergeAgentOverrides(base, override?.agents);
      if (picks.has("agents")) out.agents = merged;
      if (picks.has("styles")) {
        const styles: ContextBundle["styles"] = {};
        const roles: Array<{ slot: "opening" | "practice" | "closing"; agentKey: string }> = [
          { slot: "opening", agentKey: "writer.opening" },
          { slot: "practice", agentKey: "writer.practice" },
          { slot: "closing", agentKey: "writer.closing" },
        ];
        for (const r of roles) {
          const cfg = merged[r.agentKey];
          if (!cfg?.styleBinding) continue;
          try {
            const resolved = await resolveStyleBinding(cfg.styleBinding, this.deps.stylePanelStore);
            if (!resolved) continue;
            styles[r.slot] = {
              account: resolved.panel.frontmatter.account,
              role: resolved.panel.frontmatter.role,
              version: resolved.panel.frontmatter.version,
              bodyExcerpt: resolved.bodyContent.slice(0, 600),
            };
          } catch {
            /* skip */
          }
        }
        out.styles = styles;
      }
    }
    return out;
  }
}

/**
 * Trim a ContextBundle in-place (returns the same reference) in a deterministic
 * drop-order until the estimated token count falls below `maxTokens`.
 *
 * Drop order (matches spec §5):
 *   1. recentToolUses -> last 5, then empty
 *   2. recentEdits    -> last 3, then empty
 *   3. productContext -> 400 chars, then empty
 *   4. brief.summary  -> 400 chars
 *   5. styles.*.bodyExcerpt -> 200 chars each
 */
export function trimToBudget(bundle: ContextBundle, maxTokens = 6000): ContextBundle {
  const over = () => estimateTokens(JSON.stringify(bundle)) > maxTokens;
  if (!over()) {
    bundle._tokensEstimated = estimateTokens(JSON.stringify(bundle));
    return bundle;
  }
  bundle._truncated = true;

  // step 1a: toolUses last 5
  if (over() && bundle.recentToolUses.length > 5) {
    bundle.recentToolUses = bundle.recentToolUses.slice(-5);
  }
  // step 1b: drop entirely
  if (over()) bundle.recentToolUses = [];

  // step 2a: edits last 3
  if (over() && bundle.recentEdits.length > 3) {
    bundle.recentEdits = bundle.recentEdits.slice(0, 3);
  }
  if (over()) bundle.recentEdits = [];

  // step 3: productContext 400 chars, then drop
  if (over() && bundle.productContext && bundle.productContext.length > 400) {
    bundle.productContext = bundle.productContext.slice(0, 400);
  }
  if (over() && bundle.productContext) delete bundle.productContext;

  // step 4: brief.summary 400 chars
  if (over() && bundle.brief.summary && bundle.brief.summary.length > 400) {
    bundle.brief.summary = bundle.brief.summary.slice(0, 400);
  }

  // step 5: style excerpts 200 chars each
  if (over()) {
    for (const slot of ["opening", "practice", "closing"] as const) {
      const s = bundle.styles[slot];
      if (s && s.bodyExcerpt.length > 200) s.bodyExcerpt = s.bodyExcerpt.slice(0, 200);
    }
  }

  bundle._tokensEstimated = estimateTokens(JSON.stringify(bundle));
  return bundle;
}
