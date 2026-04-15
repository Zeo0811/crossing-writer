import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { createAgentConfigStore, type AgentConfigEntry } from "../src/services/agent-config-store.js";
import { ContextBundleService } from "../src/services/context-bundle-service.js";

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
