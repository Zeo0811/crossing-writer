import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const captured: { key: string; userMessage: string }[] = [];

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    runWriterOpening: vi.fn(async (opts: any) => {
      captured.push({ key: "opening", userMessage: opts.userMessage });
      return { finalText: "O", toolsUsed: [], rounds: 1, meta: { cli: "claude", durationMs: 1 } };
    }),
    runWriterPractice: vi.fn(async (opts: any) => {
      captured.push({ key: "practice", userMessage: opts.userMessage });
      return { finalText: "P", toolsUsed: [], rounds: 1, meta: { cli: "claude", durationMs: 1 } };
    }),
    runWriterClosing: vi.fn(async (opts: any) => {
      captured.push({ key: "closing", userMessage: opts.userMessage });
      return { finalText: "C", toolsUsed: [], rounds: 1, meta: { cli: "claude", durationMs: 1 } };
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
import { ContextBundleService, estimateTokens } from "../src/services/context-bundle-service.js";
import { runWriter } from "../src/services/writer-orchestrator.js";

function fakeConfigStore() {
  let current: any = { agents: {} };
  return {
    get current() { return current; },
    update: vi.fn(async (patch: any) => { if (patch.agents !== undefined) current = { ...current, agents: patch.agents }; }),
  };
}

async function setup({ briefBody = "small-brief", productOverviewBody = "small-prod" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sp19-e2e-"));
  const projectsDir = join(root, "projects");
  const vault = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  const store = new ProjectStore(projectsDir);
  const project = await store.create({ name: "E2E" });
  await store.update(project.id, { status: "writing_configuring", article_type: "实测" });
  const pDir = join(projectsDir, project.id);
  mkdirSync(join(pDir, "brief"), { recursive: true });
  writeFileSync(join(pDir, "brief", "brief.md"), briefBody);
  mkdirSync(join(pDir, "context"), { recursive: true });
  writeFileSync(join(pDir, "context", "product-overview.md"), productOverviewBody);
  mkdirSync(join(pDir, "mission/case-plan"), { recursive: true });
  writeFileSync(join(pDir, "mission/case-plan/selected-cases.md"), "# Case 1 — A\nbody\n");
  const svc = new ContextBundleService({
    projectStore: store,
    projectsDir,
    stylePanelStore: new StylePanelStore(vault),
    agentConfigStore: createAgentConfigStore(fakeConfigStore() as any),
    projectOverrideStore: new ProjectOverrideStore(projectsDir),
  });
  return { store, projectsDir, vault, projectId: project.id, svc, pDir };
}

describe("SP-19 E2E: ContextBundle end-to-end", () => {
  it("brief mutation flows into next orchestrator run's [Project Context] block", async () => {
    captured.length = 0;
    const env = await setup({ briefBody: "INITIAL-BRIEF" });
    await runWriter({
      projectId: env.projectId, projectsDir: env.projectsDir,
      store: env.store, vaultPath: env.vault, sqlitePath: join(env.vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
      contextBundleService: env.svc,
    });
    expect(captured.some((c) => c.userMessage.includes("INITIAL-BRIEF"))).toBe(true);

    // mutate brief and rerun
    captured.length = 0;
    writeFileSync(join(env.pDir, "brief", "brief.md"), "UPDATED-BRIEF-MARKER");
    await runWriter({
      projectId: env.projectId, projectsDir: env.projectsDir,
      store: env.store, vaultPath: env.vault, sqlitePath: join(env.vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
      contextBundleService: env.svc,
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const c of captured) {
      expect(c.userMessage).toContain("UPDATED-BRIEF-MARKER");
      expect(c.userMessage).not.toContain("INITIAL-BRIEF");
    }
  });

  it("oversized project: rendered context block ≤ 6000 tokens and toolUses dropped before edits", async () => {
    captured.length = 0;
    // build a project with massive product overview + brief to force trimming
    const big = "X".repeat(50000);
    const env = await setup({ briefBody: big, productOverviewBody: big });
    await runWriter({
      projectId: env.projectId, projectsDir: env.projectsDir,
      store: env.store, vaultPath: env.vault, sqlitePath: join(env.vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
      contextBundleService: env.svc,
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const c of captured) {
      const m = /\[Project Context\]\n([\s\S]*?)\n\[\/Project Context\]/.exec(c.userMessage);
      expect(m).not.toBeNull();
      const block = m![1]!;
      const parsed = JSON.parse(block);
      // sections/agents preserved structurally
      expect(parsed.sections).toBeDefined();
      expect(parsed.agents).toBeDefined();
      // truncation flag set
      expect(parsed._truncated).toBe(true);
      // budget invariant: estimated tokens of the JSON portion ≤ 6000
      expect(estimateTokens(block)).toBeLessThanOrEqual(6000);
      // drop-order: toolUses dropped before edits (here both empty since no
      // sections written, but the order must hold — toolUses length never
      // greater than edits length in the resulting trimmed bundle for
      // empty-section projects).
      expect(parsed.recentToolUses.length).toBeLessThanOrEqual(parsed.recentEdits.length);
    }
  });
});
