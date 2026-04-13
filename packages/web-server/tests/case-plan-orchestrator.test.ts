import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { runCasePlan } from "../src/services/case-plan-orchestrator.js";

vi.mock("@crossing/agents", () => ({
  CasePlannerExpert: vi.fn().mockImplementation((opts: any) => ({
    name: opts.name,
    round1: async () => ({ text: `# Case by ${opts.name}`, meta: { cli: "claude", model: "opus", durationMs: 50 } }),
    round2: async () => ({ text: `# Refined by ${opts.name}`, meta: { cli: "claude", model: "opus", durationMs: 60 } }),
  })),
  CaseCoordinator: vi.fn().mockImplementation(() => ({
    synthesize: async () => ({
      text: "---\ntype: case_plan_candidates\ntotal_cases: 2\n---\n# Case 01\n...",
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  runCaseExpert: async (e: any) => ({
    final: await e.round1({}), roundsUsed: 1, toolCallsMade: [],
  }),
  resolveAgent: vi.fn(() => ({ cli: "claude", model: "opus" })),
}));

vi.mock("../src/services/case-inspiration-pack-builder.js", () => ({
  buildInspirationPack: async () => "inspiration pack content",
}));

describe("runCasePlan", () => {
  it("runs experts in parallel, coordinator, writes candidates.md", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cp-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "mission"), { recursive: true });
    mkdirSync(join(projectDir, "context"), { recursive: true });
    writeFileSync(join(projectDir, "mission/selected.md"), "mission body", "utf-8");
    writeFileSync(join(projectDir, "context/product-overview.md"), "po body", "utf-8");
    await store.update(p.id, { status: "awaiting_case_expert_selection" });

    await runCasePlan({
      projectId: p.id,
      projectsDir,
      store,
      vaultPath: vault,
      sqlitePath: "/fake",
      experts: ["卡兹克", "赛博禅心"],
      expertKbs: { "卡兹克": "kb1", "赛博禅心": "kb2" },
      agents: {},
      defaultCli: "claude",
      fallbackCli: "codex",
    });

    const candPath = join(projectDir, "mission/case-plan/candidates.md");
    expect(existsSync(candPath)).toBe(true);
    expect(readFileSync(candPath, "utf-8")).toContain("case_plan_candidates");

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8");
    expect(events).toContain("case_expert.round1_started");
    expect(events).toContain("case_coordinator.synthesizing");
    expect(events).toContain("case_coordinator.done");

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("awaiting_case_selection");
  });

  it("on expert failure, moves to case_planning_failed", async () => {
    const ag = await import("@crossing/agents") as any;
    ag.CasePlannerExpert.mockImplementationOnce(() => ({
      round1: async () => { throw new Error("boom"); },
      round2: async () => {},
    }));
    const vault = mkdtempSync(join(tmpdir(), "cp-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "mission"), { recursive: true });
    mkdirSync(join(projectDir, "context"), { recursive: true });
    writeFileSync(join(projectDir, "mission/selected.md"), "m", "utf-8");
    writeFileSync(join(projectDir, "context/product-overview.md"), "po", "utf-8");

    await expect(runCasePlan({
      projectId: p.id, projectsDir, store,
      vaultPath: vault, sqlitePath: "/fake",
      experts: ["X"], expertKbs: { X: "" },
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    })).rejects.toThrow();

    const updated = await store.get(p.id);
    expect(updated?.status).toBe("case_planning_failed");
  });
});
