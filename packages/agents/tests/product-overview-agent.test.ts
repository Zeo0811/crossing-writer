import { describe, it, expect, vi } from "vitest";
import { ProductOverviewAgent } from "../src/roles/product-overview-agent.js";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(() => ({
    text: "---\ntype: product_overview\nproduct_name: X\n---\n# 产品概览\n...",
    meta: { cli: "claude", model: "opus", durationMs: 1000 },
  })),
}));

describe("ProductOverviewAgent", () => {
  it("analyzes with images + urls + description", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    const agent = new ProductOverviewAgent({ cli: "claude", model: "opus" });
    const out = await agent.analyze({
      briefImages: ["/abs/brief-fig-1.png"],
      screenshots: ["/abs/screenshot-1.png"],
      productFetchedMd: "# 官网内容",
      userDescription: "多Agent工作流平台",
      missionSummary: "测 Agent 编排能力",
    });
    expect(out.text).toContain("type: product_overview");
    expect(out.meta.cli).toBe("claude");

    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.agentKey).toBe("product_overview");
    expect(call.images).toEqual([
      "/abs/brief-fig-1.png",
      "/abs/screenshot-1.png",
    ]);
    expect(call.userMessage).toContain("多Agent工作流平台");
    expect(call.userMessage).toContain("测 Agent 编排能力");
  });

  it("throws when no images", async () => {
    const agent = new ProductOverviewAgent({ cli: "claude", model: "opus" });
    await expect(agent.analyze({
      briefImages: [], screenshots: [],
      productFetchedMd: "", userDescription: "",
      missionSummary: "",
    })).rejects.toThrow(/at least one image/i);
  });
});
