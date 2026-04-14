import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { WriterClosingAgent } from "../src/roles/writer-closing-agent.js";

describe("WriterClosingAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
    (invokeAgent as any).mockReturnValue({
      text: "# 结尾\n综合来看…",
      meta: { cli: "claude", model: "opus", durationMs: 1500 },
    });
  });

  it("reads opening + stitched practice + references in prompt", async () => {
    const agent = new WriterClosingAgent({ cli: "claude", model: "opus" });
    const out = await agent.write({
      openingText: "钩子开头…",
      stitchedPracticeText: "## Case 1…\n过渡\n## Case 2…",
      referenceAccountsKb: [{ id: "赛博禅心", text: "【结尾样本】" }],
    });
    expect(out.text).toContain("结尾");
    const call = (invokeAgent as any).mock.calls[0]![0];
    expect(call.agentKey).toBe("writer.closing");
    expect(call.userMessage).toContain("钩子开头");
    expect(call.userMessage).toContain("Case 1");
    expect(call.userMessage).toContain("Case 2");
    expect(call.userMessage).toContain("【结尾样本】");
  });

  it("accepts empty reference accounts", async () => {
    const agent = new WriterClosingAgent({ cli: "claude", model: "opus" });
    await agent.write({
      openingText: "o",
      stitchedPracticeText: "p",
      referenceAccountsKb: [],
    });
    const call = (invokeAgent as any).mock.calls[0]![0];
    expect(call.userMessage).toContain("(无参考账号)");
  });
});
