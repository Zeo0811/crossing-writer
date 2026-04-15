import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { analyzeBrief, type AnalyzeBriefOpts } from "../src/services/brief-analyzer-service.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";
import { runMission } from "../src/services/mission-orchestrator.js";

vi.mock("@crossing/agents", () => ({
  stripAgentPreamble: (s: string) => s,
  BriefAnalyst: vi.fn().mockImplementation(() => ({
    analyze: () => ({
      text: "---\ntype: brief_summary\n---\n# ok",
      meta: { cli: "codex", model: "gpt-5.4", durationMs: 1 },
    }),
  })),
  TopicExpert: vi.fn().mockImplementation((opts: any) => ({
    round1: vi.fn().mockReturnValue({
      text: `---\ntype: expert_round1\nexpert: ${opts.name}\n---\n# round1 ${opts.name}`,
      meta: { cli: "codex", model: "gpt-5.4", durationMs: 10 },
    }),
    round2: vi.fn().mockReturnValue({
      text: `---\ntype: expert_round2\nexpert: ${opts.name}\n---\n# round2 ${opts.name}`,
      meta: { cli: "codex", model: "gpt-5.4", durationMs: 10 },
    }),
  })),
  Coordinator: vi.fn().mockImplementation(() => ({
    round1Synthesize: vi.fn().mockReturnValue({
      text: "---\ntype: mission_candidates\n---\n# 候选 1\n...\n# 候选 2\n...\n# 候选 3\n...",
      meta: { cli: "codex", model: "gpt-5.4", durationMs: 10 },
    }),
    round2Aggregate: vi.fn().mockReturnValue({
      text: "---\ntype: mission_candidates\nround2_rankings: [{candidate_index: 2, aggregate_score: 8.5}]\n---\n# 候选 1\n...\n# 候选 2\n...\n# 候选 3\n...",
      meta: { cli: "codex", model: "gpt-5.4", durationMs: 10 },
    }),
  })),
  resolveAgent: vi.fn().mockReturnValue({ cli: "codex", model: "gpt-5.4" }),
}));

vi.mock("../src/services/refs-fetcher.js", () => ({
  buildRefsPack: vi.fn().mockReturnValue("mock refs pack"),
}));

describe("SSE event schema – brief analyzer", () => {
  it("brief analyzer writes agent.started with cli + model", async () => {
    const vault = mkdtempSync(join(tmpdir(), "evt-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief.md"), "body", "utf-8");
    await store.update(p.id, {
      status: "brief_uploaded",
      brief: {
        source_type: "text", raw_path: "r", md_path: "brief/brief.md",
        summary_path: null, uploaded_at: "",
      },
    });

    const opts: AnalyzeBriefOpts = {
      projectId: p.id,
      projectsDir,
      store,
      cli: "codex",
      agents: {},
      defaultCli: "codex",
      fallbackCli: "claude",
    };
    await analyzeBrief(opts);

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const started = events.find((e) => e.type === "agent.started");
    expect(started).toBeDefined();
    expect(started.data.agent).toBe("brief_analyst");
    expect(started.data.cli).toBe("codex");
    expect(started.data.model).toBe("gpt-5.4");

    const completed = events.find((e) => e.type === "agent.completed");
    expect(completed.data.cli).toBe("codex");
    expect(completed.data.model).toBe("gpt-5.4");
  });
});

describe("SSE event schema – mission orchestrator", () => {
  function mkEnv() {
    const vault = mkdtempSync(join(tmpdir(), "orch-evt-"));
    const projectsDir = join(vault, "07_projects");
    const expertsRoot = join(vault, "08_experts");
    mkdirSync(join(expertsRoot, "topic-panel/experts"), { recursive: true });
    writeFileSync(
      join(expertsRoot, "topic-panel/index.yaml"),
      `experts:\n  - name: X\n    file: experts/X.md\n    active: true\n    default_preselect: true\n    specialty: z\n`,
    );
    writeFileSync(join(expertsRoot, "topic-panel/experts/X.md"), "# X kb");
    return {
      store: new ProjectStore(projectsDir),
      registry: new ExpertRegistry(expertsRoot),
      projectsDir,
    };
  }

  it("expert.round1_started and coordinator.synthesizing carry cli + model", async () => {
    const { store, registry, projectsDir } = mkEnv();
    const p = await store.create({ name: "OrchestratorEvt" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(
      join(projectDir, "brief/brief-summary.md"),
      "---\nproduct: X\n---\n# summary",
      "utf-8",
    );
    await store.update(p.id, {
      status: "brief_ready",
      brief: {
        source_type: "text",
        raw_path: "r",
        md_path: "brief/brief.md",
        summary_path: "brief/brief-summary.md",
        uploaded_at: "",
      },
    });

    await runMission({
      projectId: p.id,
      experts: ["X"],
      store,
      registry,
      projectsDir,
      cli: "codex",
      agents: {},
      defaultCli: "codex",
      fallbackCli: "claude",
      searchCtx: { sqlitePath: "/x", vaultPath: "/v" },
    });

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));

    const round1Started = events.find((e) => e.type === "expert.round1_started");
    expect(round1Started).toBeDefined();
    expect(round1Started.data.cli).toBe("codex");
    expect(round1Started.data.model).toBe("gpt-5.4");

    const coordSynthesizing = events.find((e) => e.type === "coordinator.synthesizing");
    expect(coordSynthesizing).toBeDefined();
    expect(coordSynthesizing.data.cli).toBe("codex");
    expect(coordSynthesizing.data.model).toBe("gpt-5.4");
  });
});
