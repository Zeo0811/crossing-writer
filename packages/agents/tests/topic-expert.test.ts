import { describe, it, expect, vi } from "vitest";
import { TopicExpert, invokeTopicExpert } from "../src/roles/topic-expert.js";
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

  it("round3 injects current draft and focus", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "续写段落",
      meta: { cli: "claude", durationMs: 5 },
    });
    const expert = new TopicExpert({
      name: "X",
      kbContent: "kb",
      kbSource: "f.md",
      cli: "claude",
    });
    expert.round3({
      projectId: "p",
      runId: "r",
      currentDraft: "草稿内容 XYZ",
      focus: "强化情感",
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/草稿内容 XYZ/);
    expect(call.systemPrompt).toMatch(/强化情感/);
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

describe("invokeTopicExpert", () => {
  it("score path passes briefSummary + refsPack", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "score md",
      meta: { cli: "claude", durationMs: 7 },
    });
    const r = await invokeTopicExpert({
      name: "A", kbContent: "kb", kbSource: "f.md", cli: "claude",
      invokeType: "score",
      projectId: "p", runId: "r",
      briefSummary: "BS", refsPack: "RP",
    });
    expect(r.markdown).toBe("score md");
    expect(r.meta.durationMs).toBe(7);
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/BS/);
    expect(call.systemPrompt).toMatch(/RP/);
  });

  it("score path throws when missing fields", async () => {
    vi.spyOn(ma, "invokeAgent").mockReturnValue({ text: "", meta: { cli: "claude", durationMs: 0 } });
    await expect(invokeTopicExpert({
      name: "A", kbContent: "kb", kbSource: "f.md", cli: "claude",
      invokeType: "score", projectId: "p", runId: "r",
    })).rejects.toThrow(/briefSummary/);
  });

  it("structure path requires candidatesMd", async () => {
    vi.spyOn(ma, "invokeAgent").mockReturnValue({ text: "", meta: { cli: "claude", durationMs: 0 } });
    await expect(invokeTopicExpert({
      name: "A", kbContent: "kb", kbSource: "f.md", cli: "claude",
      invokeType: "structure", projectId: "p", runId: "r",
    })).rejects.toThrow(/candidatesMd/);
  });

  it("continue path requires currentDraft; includes focus when provided", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "cont", meta: { cli: "claude", durationMs: 1 },
    });
    await expect(invokeTopicExpert({
      name: "A", kbContent: "kb", kbSource: "f.md", cli: "claude",
      invokeType: "continue", projectId: "p", runId: "r",
    })).rejects.toThrow(/currentDraft/);

    const r = await invokeTopicExpert({
      name: "A", kbContent: "kb", kbSource: "f.md", cli: "claude",
      invokeType: "continue", projectId: "p", runId: "r",
      currentDraft: "DRAFT_X", focus: "FOCUS_Y",
    });
    expect(r.markdown).toBe("cont");
    const call = spy.mock.calls.at(-1)![0] as any;
    expect(call.systemPrompt).toMatch(/DRAFT_X/);
    expect(call.systemPrompt).toMatch(/FOCUS_Y/);
  });

  it("returns { markdown, meta } shape", async () => {
    vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "md", meta: { cli: "codex", model: "gpt", durationMs: 42 },
    });
    const r = await invokeTopicExpert({
      name: "A", kbContent: "kb", kbSource: "f.md", cli: "codex", model: "gpt",
      invokeType: "score", projectId: "p", runId: "r",
      briefSummary: "b", refsPack: "r",
    });
    expect(r.markdown).toBe("md");
    expect(r.meta).toEqual({ cli: "codex", model: "gpt", durationMs: 42 });
  });
});
