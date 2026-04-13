import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";
import { runMission } from "../src/services/mission-orchestrator.js";

vi.mock("@crossing/agents", () => ({
  TopicExpert: vi.fn().mockImplementation((opts: any) => ({
    round1: vi.fn().mockReturnValue({
      text: `---\ntype: expert_round1\nexpert: ${opts.name}\n---\n# round1 ${opts.name}`,
      meta: { cli: "codex", durationMs: 10 },
    }),
    round2: vi.fn().mockReturnValue({
      text: `---\ntype: expert_round2\nexpert: ${opts.name}\n---\n# round2 ${opts.name}`,
      meta: { cli: "codex", durationMs: 10 },
    }),
  })),
  Coordinator: vi.fn().mockImplementation(() => ({
    round1Synthesize: vi.fn().mockReturnValue({
      text: "---\ntype: mission_candidates\n---\n# 候选 1\n...\n# 候选 2\n...\n# 候选 3\n...",
      meta: { cli: "claude", durationMs: 10 },
    }),
    round2Aggregate: vi.fn().mockReturnValue({
      text: "---\ntype: mission_candidates\nround2_rankings: [{candidate_index: 2, aggregate_score: 8.5}]\n---\n# 候选 1\n...\n# 候选 2\n...\n# 候选 3\n...",
      meta: { cli: "claude", durationMs: 10 },
    }),
  })),
}));

vi.mock("../src/services/refs-fetcher.js", () => ({
  buildRefsPack: vi.fn().mockReturnValue("mock refs pack"),
}));

function mkEnv() {
  const vault = mkdtempSync(join(tmpdir(), "mo-"));
  const projectsDir = join(vault, "07_projects");
  const expertsRoot = join(vault, "08_experts");
  mkdirSync(join(expertsRoot, "topic-panel/experts"), { recursive: true });
  writeFileSync(
    join(expertsRoot, "topic-panel/index.yaml"),
    `experts:
  - name: A
    file: experts/A.md
    active: true
    default_preselect: true
    specialty: x
  - name: B
    file: experts/B.md
    active: true
    default_preselect: true
    specialty: y
`,
  );
  writeFileSync(join(expertsRoot, "topic-panel/experts/A.md"), "# A kb");
  writeFileSync(join(expertsRoot, "topic-panel/experts/B.md"), "# B kb");
  return {
    store: new ProjectStore(projectsDir),
    registry: new ExpertRegistry(expertsRoot),
    projectsDir,
  };
}

describe("runMission", () => {
  it("orchestrates round1 → synth → round2 → aggregate end-to-end", async () => {
    const { store, registry, projectsDir } = mkEnv();
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief-summary.md"), "---\nproduct: X\n---\n# summary", "utf-8");
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
      experts: ["A", "B"],
      store,
      registry,
      projectsDir,
      cli: "codex",
      searchCtx: { sqlitePath: "/x", vaultPath: "/v" },
    });

    const updated = await store.get(p.id);
    expect(updated!.status).toBe("awaiting_mission_pick");
    expect(updated!.mission.candidates_path).toBe("mission/candidates.md");
    expect(readFileSync(join(projectDir, "mission/candidates.md"), "utf-8")).toMatch(
      /mission_candidates/,
    );
    expect(readFileSync(join(projectDir, "mission/round1/A.md"), "utf-8")).toMatch(
      /round1 A/,
    );
    expect(readFileSync(join(projectDir, "mission/round1/B.md"), "utf-8")).toMatch(
      /round1 B/,
    );
    expect(readFileSync(join(projectDir, "mission/round2/A.md"), "utf-8")).toMatch(
      /round2 A/,
    );
    expect(readFileSync(join(projectDir, "mission/round2/B.md"), "utf-8")).toMatch(
      /round2 B/,
    );
    expect(existsSync(join(projectDir, "context/refs-pack.md"))).toBe(true);

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8");
    expect(events).toMatch(/expert.round1_started/);
    expect(events).toMatch(/expert.round1_completed/);
    expect(events).toMatch(/coordinator.synthesizing/);
    expect(events).toMatch(/coordinator.candidates_ready/);
    expect(events).toMatch(/expert.round2_started/);
    expect(events).toMatch(/awaiting_mission_pick/);
  });

  it("throws on missing brief summary", async () => {
    const { store, registry, projectsDir } = mkEnv();
    const p = await store.create({ name: "T2" });
    await expect(
      runMission({
        projectId: p.id,
        experts: ["A"],
        store,
        registry,
        projectsDir,
        cli: "codex",
        searchCtx: { sqlitePath: "/x", vaultPath: "/v" },
      }),
    ).rejects.toThrow(/brief summary missing/i);
  });
});
