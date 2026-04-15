import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { createAgentConfigStore, type AgentConfigEntry } from "../src/services/agent-config-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { ContextBundleService, mergeAgentOverrides } from "../src/services/context-bundle-service.js";

function fakeConfigStore(initial: Record<string, AgentConfigEntry> = {}) {
  let current: any = { agents: { ...initial } };
  return {
    get current() { return current; },
    update: vi.fn(async (patch: any) => {
      if (patch.agents !== undefined) current = { ...current, agents: patch.agents };
    }),
  };
}

export function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), "cbs-"));
  const projectsDir = join(root, "projects");
  const vaultPath = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });
  const projectStore = new ProjectStore(projectsDir);
  const stylePanelStore = new StylePanelStore(vaultPath);
  const cs = fakeConfigStore();
  const agentConfigStore = createAgentConfigStore(cs as any);
  const projectOverrideStore = new ProjectOverrideStore(projectsDir);
  return { root, projectsDir, vaultPath, projectStore, stylePanelStore, agentConfigStore, projectOverrideStore, cs };
}

describe("ContextBundleService — T1 shape", () => {
  it("build() returns bundle with all required keys for a skeletal project", async () => {
    const env = makeEnv();
    const project = await env.projectStore.create({ name: "T1 Shape" });
    const svc = new ContextBundleService({
      projectStore: env.projectStore,
      projectsDir: env.projectsDir,
      stylePanelStore: env.stylePanelStore,
      agentConfigStore: env.agentConfigStore,
      projectOverrideStore: env.projectOverrideStore,
    });
    const bundle = await svc.build(project.id);
    expect(bundle.projectId).toBe(project.id);
    expect(typeof bundle.builtAt).toBe("string");
    expect(bundle.brief).toBeDefined();
    expect(bundle.sections).toBeDefined();
    expect(bundle.frontmatter).toBeDefined();
    expect(bundle.styles).toBeDefined();
    expect(bundle.agents).toBeDefined();
    expect(bundle.recentEdits).toBeInstanceOf(Array);
    expect(bundle.recentToolUses).toBeInstanceOf(Array);
  });
});

describe("ContextBundleService — T2 composition", () => {
  it("reads brief + sections + frontmatter + recentEdits + tool uses", async () => {
    const env = makeEnv();
    const project = await env.projectStore.create({ name: "Composed" });
    const pDir = join(env.projectsDir, project.id);
    // brief + mission + product overview
    mkdirSync(join(pDir, "brief"), { recursive: true });
    writeFileSync(join(pDir, "brief", "brief.md"), "BRIEF-BODY");
    mkdirSync(join(pDir, "mission"), { recursive: true });
    writeFileSync(join(pDir, "mission", "selected.md"), "TOPIC-X");
    mkdirSync(join(pDir, "context"), { recursive: true });
    writeFileSync(join(pDir, "context", "product-overview.md"), "PROD-CTX");
    // sections
    const articles = new ArticleStore(pDir);
    await articles.init();
    await articles.writeSection("opening", {
      key: "opening",
      frontmatter: {
        section: "opening",
        last_agent: "writer.opening",
        last_updated_at: "2026-04-10T00:00:00Z",
        manually_edited: false,
        tools_used: [{ tool: "search_wiki", ts: "2026-04-10T00:00:00Z", ok: true }],
      } as any,
      body: "opening-body",
    });
    await articles.writeSection("practice.case-01" as any, {
      key: "practice.case-01" as any,
      frontmatter: {
        section: "practice.case-01",
        last_agent: "writer.practice",
        last_updated_at: "2026-04-11T00:00:00Z",
        manually_edited: true,
      } as any,
      body: "practice-body",
    });

    const svc = new ContextBundleService({
      projectStore: env.projectStore,
      projectsDir: env.projectsDir,
      stylePanelStore: env.stylePanelStore,
      agentConfigStore: env.agentConfigStore,
      projectOverrideStore: env.projectOverrideStore,
    });
    const bundle = await svc.build(project.id);
    expect(bundle.brief.summary).toBe("BRIEF-BODY");
    expect(bundle.brief.topic).toBe("TOPIC-X");
    expect(bundle.productContext).toBe("PROD-CTX");
    const keys = bundle.sections.map((s) => s.key);
    expect(keys).toContain("opening");
    expect(keys).toContain("practice.case-01");
    expect(bundle.frontmatter["opening"]!["last_agent"]).toBe("writer.opening");
    // recentEdits sorted desc by at
    expect(bundle.recentEdits[0]!.section).toBe("practice.case-01");
    expect(bundle.recentEdits[0]!.kind).toBe("manual");
    expect(bundle.recentToolUses[0]?.tool).toBe("search_wiki");
  });

  it("merges agent overrides per-field (override wins)", async () => {
    const base = {
      "writer.opening": {
        agentKey: "writer.opening",
        model: { cli: "claude" as const, model: "opus" },
        styleBinding: { account: "A", role: "opening" as const },
        tools: { search_wiki: true },
      },
    };
    const merged = mergeAgentOverrides(base, {
      "writer.opening": { model: { cli: "codex" as const } },
    });
    expect(merged["writer.opening"]!.model.cli).toBe("codex");
    expect(merged["writer.opening"]!.model.model).toBe("opus");
    expect(merged["writer.opening"]!.styleBinding!.account).toBe("A");
  });
});
