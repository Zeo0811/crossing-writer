import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";
import { runMission } from "../src/services/mission-orchestrator.js";

const round1Spy = vi.fn();
const round2Spy = vi.fn();
const synthSpy = vi.fn();
const aggregateSpy = vi.fn();

vi.mock("@crossing/agents", () => ({
  TopicExpert: vi.fn().mockImplementation((opts: any) => ({
    round1: (input: any) => {
      round1Spy({ name: opts.name, ...input });
      return {
        text: `---\ntype: expert_round1\nexpert: ${opts.name}\n---\n# round1 ${opts.name}`,
        meta: { cli: "codex", durationMs: 10 },
      };
    },
    round2: (input: any) => {
      round2Spy({ name: opts.name, ...input });
      return {
        text: `---\ntype: expert_round2\nexpert: ${opts.name}\n---\n# round2 ${opts.name}`,
        meta: { cli: "codex", durationMs: 10 },
      };
    },
  })),
  Coordinator: vi.fn().mockImplementation(() => ({
    round1Synthesize: (input: any) => {
      synthSpy(input);
      return {
        text: "---\ntype: mission_candidates\n---\n# 候选 1\n# 候选 2\n# 候选 3",
        meta: { cli: "claude", durationMs: 10 },
      };
    },
    round2Aggregate: (input: any) => {
      aggregateSpy(input);
      return {
        text: "---\ntype: mission_candidates\n---\n# 候选 1\n# 候选 2\n# 候选 3",
        meta: { cli: "claude", durationMs: 10 },
      };
    },
  })),
  resolveAgent: (_cfg: any, _key: string) => ({ cli: _cfg.modelAdapter.defaultCli }),
}));

vi.mock("../src/services/refs-fetcher.js", () => ({
  buildRefsPack: vi.fn().mockReturnValue("mock refs pack"),
}));

function mkEnv() {
  const vault = mkdtempSync(join(tmpdir(), "mo-img-"));
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
`,
  );
  writeFileSync(join(expertsRoot, "topic-panel/experts/A.md"), "# A kb");
  return {
    store: new ProjectStore(projectsDir),
    registry: new ExpertRegistry(expertsRoot),
    projectsDir,
  };
}

describe("runMission — forward brief images + addDirs", () => {
  it("propagates brief-attached images + addDirs to coordinator + experts", async () => {
    round1Spy.mockClear();
    round2Spy.mockClear();
    synthSpy.mockClear();
    aggregateSpy.mockClear();

    const { store, registry, projectsDir } = mkEnv();
    const p = await store.create({ name: "T-img" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief/images"), { recursive: true });
    writeFileSync(
      join(projectDir, "brief/brief.md"),
      "# Brief\n\n![pic1](images/a.png)\n\n![abs](/abs/b.png)\n",
      "utf-8",
    );
    writeFileSync(
      join(projectDir, "brief/brief-summary.md"),
      "---\nproduct: X\n---\n# summary\n\n![s](images/c.png)\n",
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
      experts: ["A"],
      store,
      registry,
      projectsDir,
      cli: "codex",
      agents: {},
      defaultCli: "codex",
      fallbackCli: "claude",
      searchCtx: { sqlitePath: "/x", vaultPath: "/v" },
    });

    const briefDir = join(projectDir, "brief");
    const expectedImages = [
      join(briefDir, "images/a.png"),
      "/abs/b.png",
      join(briefDir, "images/c.png"),
    ];

    expect(round1Spy).toHaveBeenCalledTimes(1);
    expect(round1Spy.mock.calls[0]![0].images).toEqual(expect.arrayContaining(expectedImages));
    expect(round1Spy.mock.calls[0]![0].addDirs).toEqual([briefDir]);

    expect(synthSpy).toHaveBeenCalledTimes(1);
    expect(synthSpy.mock.calls[0]![0].images).toEqual(expect.arrayContaining(expectedImages));
    expect(synthSpy.mock.calls[0]![0].addDirs).toEqual([briefDir]);

    expect(round2Spy).toHaveBeenCalledTimes(1);
    expect(round2Spy.mock.calls[0]![0].images).toEqual(expect.arrayContaining(expectedImages));
    expect(round2Spy.mock.calls[0]![0].addDirs).toEqual([briefDir]);

    expect(aggregateSpy).toHaveBeenCalledTimes(1);
    expect(aggregateSpy.mock.calls[0]![0].images).toEqual(expect.arrayContaining(expectedImages));
    expect(aggregateSpy.mock.calls[0]![0].addDirs).toEqual([briefDir]);
  });
});
