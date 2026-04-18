import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// For bookend (opening/closing), context is passed as projectContextBlock.
// For practice/critic, context is prepended into userMessage.
const captured: { key: string; userMessage: string; projectContextBlock?: string }[] = [];

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    runWriterBookend: vi.fn(async (opts: any) => {
      captured.push({ key: opts.role, userMessage: opts.userMessage, projectContextBlock: opts.projectContextBlock });
      return { finalText: opts.role === 'opening' ? "O" : "C", toolsUsed: [], rounds: 1, meta: { cli: "claude", durationMs: 1 } };
    }),
    runWriterPractice: vi.fn(async (opts: any) => {
      captured.push({ key: "practice", userMessage: opts.userMessage });
      return { finalText: "P", toolsUsed: [], rounds: 1, meta: { cli: "claude", durationMs: 1 } };
    }),
    runStyleCritic: vi.fn(async (opts: any) => {
      captured.push({ key: "critic", userMessage: opts.userMessage });
      return { finalText: "NO_CHANGES", toolsUsed: [], rounds: 1, meta: { cli: "claude", durationMs: 1 } };
    }),
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async () => ({ transitions: {}, meta: { cli: "claude", durationMs: 1 } })),
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { createAgentConfigStore } from "../src/services/agent-config-store.js";
import { ContextBundleService } from "../src/services/context-bundle-service.js";
import { runWriter } from "../src/services/writer-orchestrator.js";

function fakeConfigStore() {
  let current: any = { agents: {} };
  return {
    get current() { return current; },
    update: vi.fn(async (patch: any) => { if (patch.agents !== undefined) current = { ...current, agents: patch.agents }; }),
  };
}

async function seed() {
  const root = mkdtempSync(join(tmpdir(), "sp19-orch-"));
  const projectsDir = join(root, "07_projects");
  const vault = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "CtxBundleProj" });
  await store.update(p.id, { status: "writing_configuring", article_type: "实测" });
  const pDir = join(projectsDir, p.id);
  mkdirSync(join(pDir, "mission/case-plan"), { recursive: true });
  mkdirSync(join(pDir, "brief"), { recursive: true });
  writeFileSync(join(pDir, "brief", "brief.md"), "BRIEF-SNAPSHOT-TOKEN-xyz123");
  writeFileSync(
    join(pDir, "mission/case-plan/selected-cases.md"),
    "# Case 1 — A\nbody 01\n",
  );
  const svc = new ContextBundleService({
    projectStore: store,
    projectsDir,
    stylePanelStore: new StylePanelStore(vault),
    agentConfigStore: createAgentConfigStore(fakeConfigStore() as any),
    projectOverrideStore: new ProjectOverrideStore(projectsDir),
  });
  return { store, projectsDir, vault, projectId: p.id, svc };
}

describe("writer-orchestrator SP-19 ContextBundle integration", () => {
  it("prepends [Project Context] block containing project snapshot to every writer user message", async () => {
    captured.length = 0;
    const env = await seed();
    await runWriter({
      projectId: env.projectId,
      projectsDir: env.projectsDir,
      store: env.store,
      vaultPath: env.vault,
      sqlitePath: join(env.vault, "kb.sqlite"),
      defaultModel: { writer: { cli: 'claude', model: 'claude-opus-4-7' }, other: { cli: 'claude', model: 'claude-sonnet-4-5' } },
      contextBundleService: env.svc,
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const c of captured) {
      // opening/closing: context is in projectContextBlock; practice/critic: prepended in userMessage
      const contextSource = (c.key === 'opening' || c.key === 'closing')
        ? c.projectContextBlock ?? ''
        : c.userMessage;
      expect(contextSource).toContain("[Project Context]");
      expect(contextSource).toContain("BRIEF-SNAPSHOT-TOKEN-xyz123");
      expect(contextSource).toContain("[/Project Context]");
    }
  });

  it("omits block when contextBundleService is not supplied (backwards compat)", async () => {
    captured.length = 0;
    const env = await seed();
    await runWriter({
      projectId: env.projectId,
      projectsDir: env.projectsDir,
      store: env.store,
      vaultPath: env.vault,
      sqlitePath: join(env.vault, "kb.sqlite"),
      defaultModel: { writer: { cli: 'claude', model: 'claude-opus-4-7' }, other: { cli: 'claude', model: 'claude-sonnet-4-5' } },
    });
    for (const c of captured) {
      const contextSource = (c.key === 'opening' || c.key === 'closing')
        ? c.projectContextBlock ?? ''
        : c.userMessage;
      expect(contextSource).not.toContain("[Project Context]");
    }
  });
});
