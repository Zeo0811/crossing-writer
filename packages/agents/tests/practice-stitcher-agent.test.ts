import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { PracticeStitcherAgent } from "../src/roles/practice-stitcher-agent.js";

describe("PracticeStitcherAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
  });

  it("produces transitions map with (n-1) entries for n cases", async () => {
    (invokeAgent as any).mockReturnValue({
      text: [
        "## transition.case-01-to-case-02",
        "聊完文档对话，我们把压力给到更硬的需求——",
        "",
        "## transition.case-02-to-case-03",
        "接下来是更刁钻的场景。",
      ].join("\n"),
      meta: { cli: "claude", model: "haiku", durationMs: 500 },
    });

    const agent = new PracticeStitcherAgent({ cli: "claude", model: "haiku" });
    const out = await agent.stitch({
      cases: [
        { caseId: "case-01", firstLines: "开头段1", lastLines: "结尾段1" },
        { caseId: "case-02", firstLines: "开头段2", lastLines: "结尾段2" },
        { caseId: "case-03", firstLines: "开头段3", lastLines: "结尾段3" },
      ],
    });

    expect(out.transitions["case-01-to-case-02"]).toContain("压力给到更硬");
    expect(out.transitions["case-02-to-case-03"]).toContain("刁钻");
    expect(Object.keys(out.transitions).length).toBe(2);
  });

  it("returns empty map for single case", async () => {
    const agent = new PracticeStitcherAgent({ cli: "claude", model: "haiku" });
    const out = await agent.stitch({
      cases: [{ caseId: "case-01", firstLines: "a", lastLines: "b" }],
    });
    expect(out.transitions).toEqual({});
    expect((invokeAgent as any).mock.calls.length).toBe(0);
  });
});
