import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

const captured: string[] = [];

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    invokeAgent: vi.fn(() => ({ text: "", meta: { cli: "claude", durationMs: 1 } })),
    runWriterOpening: vi.fn(async ({ userMessage }: any) => {
      captured.push(userMessage);
      return { finalText: "NEWTEXT", toolsUsed: [], rounds: 1 };
    }),
    runWriterPractice: vi.fn(async ({ userMessage }: any) => {
      captured.push(userMessage);
      return { finalText: "NEWTEXT", toolsUsed: [], rounds: 1 };
    }),
    runWriterClosing: vi.fn(async ({ userMessage }: any) => {
      captured.push(userMessage);
      return { finalText: "NEWTEXT", toolsUsed: [], rounds: 1 };
    }),
  };
});
vi.mock("@crossing/kb", async () => {
  const actual = await vi.importActual<any>("@crossing/kb");
  return { ...actual, dispatchSkill: vi.fn() };
});

import { ProjectStore } from "../src/services/project-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { createAgentConfigStore } from "../src/services/agent-config-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { ContextBundleService } from "../src/services/context-bundle-service.js";
import { registerWriterRewriteSelectionRoutes } from "../src/routes/writer-rewrite-selection.js";

function fakeConfigStore() {
  let current: any = { agents: {} };
  return {
    get current() { return current; },
    update: vi.fn(async (patch: any) => { if (patch.agents !== undefined) current = { ...current, agents: patch.agents }; }),
  };
}

async function seed() {
  const root = mkdtempSync(join(tmpdir(), "sp19-sel-"));
  const projectsDir = join(root, "projects");
  const vault = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "CtxSel" });
  const pDir = join(projectsDir, p.id);
  mkdirSync(join(pDir, "brief"), { recursive: true });
  writeFileSync(join(pDir, "brief", "brief.md"), "BRIEF-REWRITE-TOKEN-abc789");
  const articles = new ArticleStore(pDir);
  await articles.init();
  await articles.writeSection("opening", {
    key: "opening",
    frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "x" },
    body: "hello OLDTEXT world",
  });
  const svc = new ContextBundleService({
    projectStore: store,
    projectsDir,
    stylePanelStore: new StylePanelStore(vault),
    agentConfigStore: createAgentConfigStore(fakeConfigStore() as any),
    projectOverrideStore: new ProjectOverrideStore(projectsDir),
  });
  const app = Fastify();
  registerWriterRewriteSelectionRoutes(app, {
    store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
    configStore: { get: async () => ({}) } as any,
    contextBundleService: svc,
  });
  await app.ready();
  return { app, projectId: p.id };
}

describe("rewrite-selection SP-19 ContextBundle integration", () => {
  it("prepends [Project Context] block containing brief snapshot", async () => {
    captured.length = 0;
    const env = await seed();
    const res = await env.app.inject({
      method: "POST",
      url: `/api/projects/${env.projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "OLDTEXT", user_prompt: "change it" },
    });
    expect([200, 204]).toContain(res.statusCode);
    expect(captured.length).toBe(1);
    expect(captured[0]!).toContain("[Project Context]");
    expect(captured[0]!).toContain("BRIEF-REWRITE-TOKEN-abc789");
    expect(captured[0]!).toContain("[/Project Context]");
    // ensure legacy prompt still present after the context block
    expect(captured[0]!).toContain("[需要改写的部分]");
  });
});
