import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  const runWriterBookend = vi.fn(async (opts: any) => ({
    finalText: opts.role === 'opening' ? "OPENING" : "CLOSING",
    toolsUsed: [],
    rounds: 1,
    meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
    __captured: opts,
  }));
  const runWriterPractice = vi.fn(async () => ({
    finalText: "PRACTICE",
    toolsUsed: [],
    rounds: 1,
    meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
  }));
  const runStyleCritic = vi.fn(async () => ({
    finalText: "NO_CHANGES",
    toolsUsed: [],
    rounds: 1,
    meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
  }));
  return {
    ...actual,
    runWriterBookend,
    runWriterPractice,
    runStyleCritic,
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async () => ({ transitions: {}, meta: { cli: "claude", durationMs: 1 } })),
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { runWriter } from "../src/services/writer-orchestrator.js";
import type { StylePanel } from "../src/services/style-panel-types.js";

function setup() {
  const vault = mkdtempSync(join(tmpdir(), "sp10-orch-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  return { vault, projectsDir, store };
}

async function seed(store: ProjectStore, projectsDir: string) {
  const project = await store.create({ name: "T" });
  await store.update(project.id, { status: "writing_configuring", article_type: "实测" });
  const pDir = join(projectsDir, project.id);
  mkdirSync(join(pDir, "mission/case-plan"), { recursive: true });
  mkdirSync(join(pDir, "context"), { recursive: true });
  mkdirSync(join(pDir, "evidence/case-01/screenshots"), { recursive: true });
  writeFileSync(join(pDir, "mission/selected.md"), "---\n---\nmission body\n", "utf-8");
  writeFileSync(join(pDir, "context/product-overview.md"), "---\n---\noverview\n", "utf-8");
  writeFileSync(
    join(pDir, "mission/case-plan/selected-cases.md"),
    "---\n---\n\n# Case 1 — First\ndesc\n",
    "utf-8",
  );
  writeFileSync(
    join(pDir, "evidence/case-01/notes.md"),
    "---\ncase_id: case-01\n---\nnotes\n",
    "utf-8",
  );
  return project.id;
}

function panel(account: string, role: "opening" | "practice" | "closing", version: number): StylePanel {
  return {
    frontmatter: {
      account,
      role,
      version,
      status: "active",
      created_at: "2026-01-01",
      source_article_count: 3,
    },
    body: `BODY_${account}_${role}_v${version}`,
    absPath: `/tmp/${account}-${role}-v${version}.md`,
  };
}

describe("writer-orchestrator sp10 style binding integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects styleBinding typeSection into systemPrompt when all bindings resolve", async () => {
    const { vault, projectsDir, store } = setup();
    const pid = await seed(store, projectsDir);

    const resolveStyleForAgent = vi.fn(async (agentKey: string) => {
      if (agentKey === "writer.opening") {
        return { panel: panel("acctA", "opening", 2), typeSection: "OPENING_STYLE_BODY", hardRulesBlock: "" };
      }
      if (agentKey === "writer.practice") {
        return { panel: panel("acctA", "practice", 1), typeSection: "PRACTICE_STYLE_BODY", hardRulesBlock: "" };
      }
      if (agentKey === "writer.closing") {
        return { panel: panel("acctA", "closing", 1), typeSection: "CLOSING_STYLE_BODY", hardRulesBlock: "" };
      }
      return null;
    });

    const result = await runWriter({
      projectId: pid,
      projectsDir,
      store,
      vaultPath: vault,
      sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {} },
      resolveStyleForAgent,
    });

    expect(result).toBeUndefined();

    const agents = await import("@crossing/agents");
    const bookendCalls = (agents.runWriterBookend as any).mock.calls;
    const openingCall = bookendCalls.find((c: any[]) => c[0].role === 'opening')?.[0];
    expect(openingCall.pinnedContext).toContain("Style Reference — acctA/opening v2");
    expect(openingCall.pinnedContext).toContain("OPENING_STYLE_BODY");

    const practiceCall = (agents.runWriterPractice as any).mock.calls[0][0];
    expect(practiceCall.pinnedContext).toContain("Style Reference — acctA/practice v1");
    expect(practiceCall.pinnedContext).toContain("PRACTICE_STYLE_BODY");

    const closingCall = bookendCalls.find((c: any[]) => c[0].role === 'closing')?.[0];
    expect(closingCall.pinnedContext).toContain("Style Reference — acctA/closing v1");
    expect(closingCall.pinnedContext).toContain("CLOSING_STYLE_BODY");
  });

  it("blocks when any writer agent missing a binding and emits run.blocked", async () => {
    const { vault, projectsDir, store } = setup();
    const pid = await seed(store, projectsDir);

    const resolveStyleForAgent = vi.fn(async (agentKey: string) => {
      if (agentKey === "writer.opening") {
        return { panel: panel("acctA", "opening", 1), typeSection: "O", hardRulesBlock: "" };
      }
      if (agentKey === "writer.practice") {
        return { panel: panel("acctA", "practice", 1), typeSection: "P", hardRulesBlock: "" };
      }
      if (agentKey === "writer.closing") {
        const err: any = new Error("missing");
        err.name = "StyleNotBoundError";
        err.binding = { account: "acctA", role: "closing" };
        err.reason = "missing";
        throw err;
      }
      return null;
    });

    const events: any[] = [];
    const onEvent = (ev: any) => events.push(ev);

    const result = (await runWriter({
      projectId: pid,
      projectsDir,
      store,
      vaultPath: vault,
      sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {} },
      resolveStyleForAgent,
      onEvent,
    })) as any;

    expect(result).toEqual({
      blocked: true,
      missingBindings: [
        { agentKey: "writer.closing", account: "acctA", role: "closing", reason: "missing" },
      ],
    });

    const blockedEv = events.find((e) => e.type === "run.blocked");
    expect(blockedEv).toBeDefined();
    expect(blockedEv.missingBindings).toHaveLength(1);
    expect(blockedEv.missingBindings[0].agentKey).toBe("writer.closing");

    const agents = await import("@crossing/agents");
    expect((agents.runWriterBookend as any)).not.toHaveBeenCalled();
    expect((agents.runWriterPractice as any)).not.toHaveBeenCalled();
  });

  it("runs successfully when resolver returns a binding (simulating project override providing one)", async () => {
    const { vault, projectsDir, store } = setup();
    const pid = await seed(store, projectsDir);

    // Simulates: global had no binding for writer.closing, but project override provides one.
    // The route-layer resolver is responsible for the merge; here we just verify orchestrator
    // happily proceeds when resolver returns content for all three agents.
    const resolveStyleForAgent = vi.fn(async (agentKey: string) => {
      const map: Record<string, { account: string; role: any; version: number; body: string }> = {
        "writer.opening": { account: "globalA", role: "opening", version: 1, body: "GO" },
        "writer.practice": { account: "globalA", role: "practice", version: 1, body: "GP" },
        "writer.closing": { account: "overrideB", role: "closing", version: 3, body: "OC" },
      };
      const spec = map[agentKey];
      if (!spec) return null;
      return {
        panel: panel(spec.account, spec.role, spec.version),
        typeSection: spec.body,
        hardRulesBlock: "",
      };
    });

    const result = await runWriter({
      projectId: pid,
      projectsDir,
      store,
      vaultPath: vault,
      sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {} },
      resolveStyleForAgent,
    });

    expect(result).toBeUndefined();
    const agents = await import("@crossing/agents");
    const bookendCalls = (agents.runWriterBookend as any).mock.calls;
    const closingCall = bookendCalls.find((c: any[]) => c[0].role === 'closing')?.[0];
    expect(closingCall.pinnedContext).toContain("Style Reference — overrideB/closing v3");
    expect(closingCall.pinnedContext).toContain("OC");
  });
});
