import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { StyleDistillerStructureAgent } from "../src/roles/style-distiller-structure-agent.js";

describe("StyleDistillerStructureAgent", () => {
  beforeEach(() => { (invokeAgent as any).mockReset(); });

  it("embeds sample articles + quant summary in user message, returns text", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "# 结构提炼\n一、核心定位\n...",
      meta: { cli: "claude", model: "opus", durationMs: 1000 },
    });
    const agent = new StyleDistillerStructureAgent({ cli: "claude", model: "opus" });
    const out = await agent.distill({
      account: "赛博禅心",
      samples: [
        { id: "2025-06-01_a", title: "T1", published_at: "2025-06-01", word_count: 2000, body_plain: "正文 A" },
        { id: "2025-09-10_b", title: "T2", published_at: "2025-09-10", word_count: 3500, body_plain: "正文 B" },
      ],
      quantSummary: "中位数字数 3200",
    });
    expect(out.text).toContain("结构提炼");
    const call = (invokeAgent as any).mock.calls[0][0];
    expect(call.agentKey).toBe("style_distiller.structure");
    expect(call.cli).toBe("claude");
    expect(call.systemPrompt.length).toBeGreaterThan(200);
    expect(call.userMessage).toContain("赛博禅心");
    expect(call.userMessage).toContain("2025-06-01_a");
    expect(call.userMessage).toContain("正文 A");
    expect(call.userMessage).toContain("中位数字数 3200");
  });

  it("throws if samples empty", async () => {
    const agent = new StyleDistillerStructureAgent({ cli: "claude" });
    await expect(agent.distill({ account: "x", samples: [], quantSummary: "" })).rejects.toThrow(/at least one sample/);
  });
});
