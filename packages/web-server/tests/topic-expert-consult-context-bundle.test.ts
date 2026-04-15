import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { createAgentConfigStore } from "../src/services/agent-config-store.js";
import { ContextBundleService } from "../src/services/context-bundle-service.js";
import { runTopicExpertConsult, type ConsultEvent } from "../src/services/topic-expert-consult.js";

function fakeConfigStore() {
  let current: any = { agents: {} };
  return {
    get current() { return current; },
    update: vi.fn(async (patch: any) => { if (patch.agents !== undefined) current = { ...current, agents: patch.agents }; }),
  };
}

function fakeExpertStore() {
  return {
    get: vi.fn(async (name: string) => ({
      name, specialty: "x", active: true, default_preselect: false,
      soft_deleted: false, kb_markdown: `kb-${name}`, word_count: 10,
    })),
  } as any;
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "sp19-tex-"));
  const projectsDir = join(root, "projects");
  const vault = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  const store = new ProjectStore(projectsDir);
  const project = await store.create({ name: "TopicCtx" });
  const pDir = join(projectsDir, project.id);
  mkdirSync(join(pDir, "brief"), { recursive: true });
  writeFileSync(join(pDir, "brief", "brief.md"), "BRIEF-TOPIC-TOKEN-zzz999");
  const svc = new ContextBundleService({
    projectStore: store,
    projectsDir,
    stylePanelStore: new StylePanelStore(vault),
    agentConfigStore: createAgentConfigStore(fakeConfigStore() as any),
    projectOverrideStore: new ProjectOverrideStore(projectsDir),
  });
  return { svc, projectId: project.id };
}

describe("topic-expert consult SP-19 ContextBundle integration", () => {
  it("prepends [Project Context] block into briefSummary on score invokes", async () => {
    const env = await setup();
    const passedArgs: any[] = [];
    const invoke = vi.fn(async (a: any) => {
      passedArgs.push(a);
      return { markdown: "md", meta: { cli: "claude", durationMs: 1 } };
    });
    const events: ConsultEvent[] = [];
    await runTopicExpertConsult(
      {
        projectId: env.projectId,
        selectedExperts: ["A"],
        invokeType: "score",
        brief: "user-brief",
        productContext: "pc",
      },
      {
        store: fakeExpertStore(),
        invoke,
        emit: (e) => events.push(e),
        contextBundleService: env.svc,
      },
    );
    expect(passedArgs).toHaveLength(1);
    expect(passedArgs[0].briefSummary).toContain("[Project Context]");
    expect(passedArgs[0].briefSummary).toContain("BRIEF-TOPIC-TOKEN-zzz999");
    expect(passedArgs[0].briefSummary).toContain("user-brief");
  });

  it("does not prefix when contextBundleService not supplied (backwards compat)", async () => {
    const env = await setup();
    const passedArgs: any[] = [];
    const invoke = vi.fn(async (a: any) => {
      passedArgs.push(a);
      return { markdown: "md", meta: { cli: "claude", durationMs: 1 } };
    });
    await runTopicExpertConsult(
      {
        projectId: env.projectId,
        selectedExperts: ["A"],
        invokeType: "score",
        brief: "user-brief",
      },
      { store: fakeExpertStore(), invoke, emit: () => {} },
    );
    expect(passedArgs[0].briefSummary).toBe("user-brief");
    expect(passedArgs[0].briefSummary).not.toContain("[Project Context]");
  });
});
