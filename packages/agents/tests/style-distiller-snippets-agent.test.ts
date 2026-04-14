import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { StyleDistillerSnippetsAgent } from "../src/roles/style-distiller-snippets-agent.js";

describe("StyleDistillerSnippetsAgent", () => {
  beforeEach(() => { (invokeAgent as any).mockReset(); });

  it("parses JSON list of candidates from agent output", async () => {
    (invokeAgent as any).mockReturnValue({
      text: JSON.stringify([
        { tag: "opening.data", from: "2025-06-01_a", excerpt: "据 X 统计", position_ratio: 0.03, length: 8 },
        { tag: "closing.blank", from: "2025-06-01_a", excerpt: "刚刚开始", position_ratio: 0.97, length: 4 },
      ]),
      meta: { cli: "claude", model: "opus", durationMs: 1000 },
    });
    const agent = new StyleDistillerSnippetsAgent({ cli: "claude", model: "opus" });
    const out = await agent.harvest({
      account: "X",
      batchIndex: 0,
      totalBatches: 2,
      articles: [{ id: "2025-06-01_a", title: "T", published_at: "2025-06-01", word_count: 1000, body_plain: "据 X 统计..." }],
    });
    expect(out.candidates).toHaveLength(2);
    expect(out.candidates[0]!.tag).toBe("opening.data");
    expect(out.candidates[0]!.from).toBe("2025-06-01_a");
  });

  it("strips markdown code fence around JSON", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "```json\n[{\"tag\":\"bold.judgment\",\"from\":\"a\",\"excerpt\":\"不是 X\",\"position_ratio\":0.5,\"length\":5}]\n```",
      meta: { cli: "claude", model: "opus", durationMs: 1 },
    });
    const agent = new StyleDistillerSnippetsAgent({ cli: "claude" });
    const out = await agent.harvest({ account: "X", batchIndex: 0, totalBatches: 1, articles: [{ id: "a", title: "T", published_at: "2025-01-01", word_count: 100, body_plain: "x" }] });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]!.tag).toBe("bold.judgment");
  });

  it("throws on invalid JSON output", async () => {
    (invokeAgent as any).mockReturnValue({ text: "not json", meta: { cli: "claude", model: null, durationMs: 1 } });
    const agent = new StyleDistillerSnippetsAgent({ cli: "claude" });
    await expect(agent.harvest({ account: "X", batchIndex: 0, totalBatches: 1, articles: [{ id: "a", title: "T", published_at: "2025-01-01", word_count: 100, body_plain: "x" }] })).rejects.toThrow(/parse/i);
  });
});
