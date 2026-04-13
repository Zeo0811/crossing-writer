import { describe, it, expect, vi } from "vitest";
import { TopicExpert } from "../src/roles/topic-expert.js";
import * as ma from "../src/model-adapter.js";

describe("TopicExpert", () => {
  it("round1 injects kb + brief summary + refs pack into prompt", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "---\ntype: expert_round1\n---\n",
      meta: { cli: "claude", durationMs: 5 },
    });
    const expert = new TopicExpert({
      name: "赛博禅心",
      kbContent: "## kb style\nDeep analytical",
      kbSource: "08_experts/topic-panel/experts/赛博禅心_kb.md",
      cli: "claude",
    });
    expert.round1({
      projectId: "p1",
      runId: "run-1",
      briefSummary: "brief summary text",
      refsPack: "refs pack text",
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/赛博禅心/);
    expect(call.systemPrompt).toMatch(/Deep analytical/);
    expect(call.systemPrompt).toMatch(/brief summary text/);
    expect(call.systemPrompt).toMatch(/refs pack text/);
    expect(call.agentKey).toBe("topic_expert.赛博禅心");
  });

  it("round2 injects candidates md", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "---\ntype: expert_round2\n---\n",
      meta: { cli: "claude", durationMs: 5 },
    });
    const expert = new TopicExpert({
      name: "X",
      kbContent: "kb content X",
      kbSource: "f.md",
      cli: "claude",
    });
    expert.round2({
      projectId: "p1",
      runId: "run-1",
      candidatesMd: "# 候选 1\n...\n# 候选 2\n...",
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/候选 1/);
    expect(call.systemPrompt).toMatch(/候选 2/);
    expect(call.systemPrompt).toMatch(/kb content X/);
  });

  it("propagates model option", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "", meta: { cli: "codex", durationMs: 0 },
    });
    const expert = new TopicExpert({
      name: "Y", kbContent: "kb", kbSource: "f.md", cli: "codex", model: "gpt-5.4",
    });
    expert.round1({ projectId: "p", runId: "r", briefSummary: "b", refsPack: "r" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ cli: "codex", model: "gpt-5.4" }),
    );
  });
});
