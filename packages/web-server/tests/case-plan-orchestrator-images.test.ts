import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { runCasePlan } from "../src/services/case-plan-orchestrator.js";

const round1Spy = vi.fn();
const synthSpy = vi.fn();

vi.mock("@crossing/agents", () => ({
  stripAgentPreamble: (s: string) => s,
  CasePlannerExpert: vi.fn().mockImplementation((opts: any) => ({
    name: opts.name,
    round1: async (input: any) => {
      round1Spy({ name: opts.name, ...input });
      return { text: `# draft ${opts.name}`, meta: { cli: "claude", durationMs: 1 } };
    },
    round2: async () => ({ text: "r2", meta: { cli: "claude", durationMs: 1 } }),
  })),
  CaseCoordinator: vi.fn().mockImplementation(() => ({
    synthesize: async (input: any) => {
      synthSpy(input);
      return {
        text: "---\ntype: case_plan_candidates\n---\n# Case 01\n",
        meta: { cli: "claude", durationMs: 1 },
      };
    },
  })),
  runCaseExpert: async (e: any, input: any) => ({
    final: await e.round1(input), roundsUsed: 1, toolCallsMade: [],
  }),
  resolveAgent: vi.fn(() => ({ cli: "claude", model: "opus" })),
}));

vi.mock("../src/services/case-inspiration-pack-builder.js", () => ({
  buildInspirationPack: async () => "inspiration pack",
}));

describe("runCasePlan — forwards project images + addDirs", () => {
  it("passes collected brief/context images to CasePlannerExpert.round1 and CaseCoordinator.synthesize", async () => {
    round1Spy.mockClear();
    synthSpy.mockClear();

    const vault = mkdtempSync(join(tmpdir(), "cp-img-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T-img" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "mission"), { recursive: true });
    mkdirSync(join(projectDir, "context"), { recursive: true });
    mkdirSync(join(projectDir, "brief/images"), { recursive: true });
    writeFileSync(join(projectDir, "brief/images/fig1.png"), "x");
    writeFileSync(join(projectDir, "mission/selected.md"), "m", "utf-8");
    writeFileSync(join(projectDir, "context/product-overview.md"), "po", "utf-8");

    await runCasePlan({
      projectId: p.id, projectsDir, store,
      vaultPath: vault, sqlitePath: "/fake",
      experts: ["A"], expertKbs: { A: "kb" },
      agents: {}, defaultCli: "claude", fallbackCli: "codex",
    });

    expect(round1Spy).toHaveBeenCalledTimes(1);
    const r1Arg = round1Spy.mock.calls[0]![0];
    expect(r1Arg.images).toEqual(expect.arrayContaining([join(projectDir, "brief/images/fig1.png")]));
    expect(r1Arg.addDirs).toEqual([projectDir]);

    expect(synthSpy).toHaveBeenCalledTimes(1);
    const sArg = synthSpy.mock.calls[0]![0];
    expect(sArg.images).toEqual(expect.arrayContaining([join(projectDir, "brief/images/fig1.png")]));
    expect(sArg.addDirs).toEqual([projectDir]);
  });
});
