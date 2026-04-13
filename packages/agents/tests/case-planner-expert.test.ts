import { describe, it, expect, vi } from "vitest";
import { CasePlannerExpert } from "../src/roles/case-planner-expert.js";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(() => ({
    text: "# Case 1\n---\ntype: case\nname: X\n---\n正文",
    meta: { cli: "claude", model: "opus", durationMs: 100 },
  })),
}));

describe("CasePlannerExpert", () => {
  it("round1 passes mission + overview + inspiration + kb", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    const expert = new CasePlannerExpert({
      name: "卡兹克",
      cli: "claude",
      kbMarkdown: "我专注视频测评",
    });
    await expert.round1({
      missionSummary: "m",
      productOverview: "po",
      inspirationPack: "ip",
    });
    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.systemPrompt).toContain("卡兹克");
    expect(call.userMessage).toContain("m");
    expect(call.userMessage).toContain("po");
    expect(call.userMessage).toContain("ip");
    expect(call.userMessage).toContain("我专注视频测评");
  });

  it("round2 passes round1 draft + tool results", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    vi.mocked(invokeAgent).mockClear();
    const expert = new CasePlannerExpert({
      name: "卡兹克", cli: "claude", kbMarkdown: "",
    });
    await expert.round2({
      round1Draft: "prev draft",
      toolResults: "tool out",
    });
    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.systemPrompt).toContain("prev draft");
    expect(call.systemPrompt).toContain("tool out");
  });
});
