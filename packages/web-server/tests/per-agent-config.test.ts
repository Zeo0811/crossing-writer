import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";
import { analyzeBrief } from "../src/services/brief-analyzer-service.js";
import { runMission } from "../src/services/mission-orchestrator.js";

const briefAnalystMock = vi.fn().mockReturnValue({
  text: "---\ntype: brief_summary\n---\n# s",
  meta: { cli: "claude", durationMs: 1 },
});
const topicExpertRound1Mock = vi.fn().mockReturnValue({
  text: "---\ntype: expert_round1\n---\n# r1",
  meta: { cli: "codex", durationMs: 1 },
});
const topicExpertRound2Mock = vi.fn().mockReturnValue({
  text: "---\ntype: expert_round2\n---\n# r2",
  meta: { cli: "codex", durationMs: 1 },
});
const coordR1Mock = vi.fn().mockReturnValue({
  text: "---\ntype: mission_candidates\n---\n# 候选 1\n",
  meta: { cli: "claude", durationMs: 1 },
});
const coordR2Mock = vi.fn().mockReturnValue({
  text: "---\n---\n# 候选 1\n",
  meta: { cli: "claude", durationMs: 1 },
});

vi.mock("@crossing/agents", () => ({
  BriefAnalyst: vi.fn().mockImplementation(() => ({ analyze: briefAnalystMock })),
  TopicExpert: vi.fn().mockImplementation(() => ({
    round1: topicExpertRound1Mock,
    round2: topicExpertRound2Mock,
  })),
  Coordinator: vi.fn().mockImplementation(() => ({
    round1Synthesize: coordR1Mock,
    round2Aggregate: coordR2Mock,
  })),
  resolveAgent: vi.fn(),
}));

vi.mock("../src/services/refs-fetcher.js", () => ({
  buildRefsPack: vi.fn().mockReturnValue("mock refs"),
}));

import { BriefAnalyst, TopicExpert, Coordinator, resolveAgent } from "@crossing/agents";

function mkEnv() {
  const vault = mkdtempSync(join(tmpdir(), "pac-"));
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

describe("per-agent config resolution", () => {
  it("analyzeBrief uses resolved config for BriefAnalyst", async () => {
    vi.mocked(resolveAgent).mockReturnValue({ cli: "claude", model: "opus" });
    vi.mocked(BriefAnalyst).mockClear();

    const { store, projectsDir } = mkEnv();
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

    await analyzeBrief({
      projectId: p.id,
      projectsDir,
      store,
      cli: "codex",  // 默认 cli
      agents: { brief_analyst: { cli: "claude", model: "opus" } },
      defaultCli: "codex",
      fallbackCli: "claude",
    } as any);

    expect(resolveAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        modelAdapter: expect.anything(),
        agents: expect.objectContaining({ brief_analyst: expect.anything() }),
      }),
      "brief_analyst",
    );
    expect(BriefAnalyst).toHaveBeenCalledWith(
      expect.objectContaining({ cli: "claude", model: "opus" }),
    );
  });

  it("runMission resolves per-expert config for each TopicExpert instance", async () => {
    vi.mocked(resolveAgent).mockImplementation((_cfg: any, key: string) => {
      if (key === "topic_expert.A") return { cli: "claude", model: "opus" };
      if (key === "topic_expert.B") return { cli: "codex" };
      if (key === "coordinator") return { cli: "claude", model: "opus" };
      return { cli: "codex" };
    });
    vi.mocked(TopicExpert).mockClear();
    vi.mocked(Coordinator).mockClear();

    const { store, registry, projectsDir } = mkEnv();
    const p = await store.create({ name: "T2" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief-summary.md"), "---\nproduct: X\n---", "utf-8");
    await store.update(p.id, {
      status: "brief_ready",
      brief: {
        source_type: "text", raw_path: "r", md_path: "brief/brief.md",
        summary_path: "brief/brief-summary.md", uploaded_at: "",
      },
    });

    await runMission({
      projectId: p.id,
      experts: ["A", "B"],
      store, registry, projectsDir,
      cli: "codex",
      agents: {
        "topic_expert.A": { cli: "claude", model: "opus" },
        "coordinator": { cli: "claude", model: "opus" },
      },
      defaultCli: "codex",
      fallbackCli: "claude",
      searchCtx: { sqlitePath: "/x", vaultPath: "/v" },
    } as any);

    // 检查 TopicExpert 被实例化了 4 次（A r1, B r1, A r2, B r2）
    expect(TopicExpert).toHaveBeenCalledTimes(4);

    // 至少一次 TopicExpert 用 claude+opus（expert A）
    const topicCalls = vi.mocked(TopicExpert).mock.calls;
    const aCalls = topicCalls.filter((c) => (c[0] as any).name === "A");
    expect(aCalls.length).toBe(2);
    aCalls.forEach((c) => {
      expect((c[0] as any).cli).toBe("claude");
      expect((c[0] as any).model).toBe("opus");
    });

    // B 用 codex
    const bCalls = topicCalls.filter((c) => (c[0] as any).name === "B");
    expect(bCalls.length).toBe(2);
    bCalls.forEach((c) => {
      expect((c[0] as any).cli).toBe("codex");
    });

    // Coordinator 用 claude+opus
    expect(Coordinator).toHaveBeenCalledWith(
      expect.objectContaining({ cli: "claude", model: "opus" }),
    );
  });
});
