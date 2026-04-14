import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { WriterOpeningAgent } from "../src/roles/writer-opening-agent.js";

describe("WriterOpeningAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
    (invokeAgent as any).mockReturnValue({
      text: "# 开头正文\n这是钩子…",
      meta: { cli: "claude", model: "opus", durationMs: 1234 },
    });
  });

  it("injects reference account style kb into system prompt", async () => {
    const agent = new WriterOpeningAgent({ cli: "claude", model: "opus" });
    const out = await agent.write({
      briefSummary: "一款新的 AI 笔记工具",
      missionSummary: "面向知识工作者…",
      productOverview: "# 产品概览\n…",
      referenceAccountsKb: [
        { id: "赛博禅心", text: "【代表文风片段 1】…" },
      ],
    });
    expect(out.text).toContain("开头正文");
    expect(out.meta.cli).toBe("claude");
    const call = (invokeAgent as any).mock.calls[0]![0];
    expect(call.agentKey).toBe("writer.opening");
    expect(call.systemPrompt).toContain("十字路口");
    expect(call.userMessage).toContain("赛博禅心");
    expect(call.userMessage).toContain("【代表文风片段 1】");
    expect(call.userMessage).toContain("一款新的 AI 笔记工具");
  });

  it("works without reference accounts (empty array)", async () => {
    const agent = new WriterOpeningAgent({ cli: "claude", model: "opus" });
    const out = await agent.write({
      briefSummary: "brief",
      missionSummary: "m",
      productOverview: "po",
      referenceAccountsKb: [],
    });
    expect(out.text.length).toBeGreaterThan(0);
    const call = (invokeAgent as any).mock.calls[0]![0];
    expect(call.userMessage).toContain("(无参考账号)");
  });
});
