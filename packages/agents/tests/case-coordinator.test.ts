import { describe, it, expect, vi } from "vitest";
import { CaseCoordinator } from "../src/roles/case-coordinator.js";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(() => ({
    text: "---\ntype: case_plan_candidates\ntotal_cases: 3\n---\n# Case 01\n...",
    meta: { cli: "claude", model: "opus", durationMs: 200 },
  })),
}));

describe("CaseCoordinator", () => {
  it("synthesizes all experts' outputs", async () => {
    const { invokeAgent } = await import("../src/model-adapter.js");
    const c = new CaseCoordinator({ cli: "claude", model: "opus" });
    const r = await c.synthesize({
      expertOutputs: [
        { expert: "A", text: "# Case X" },
        { expert: "B", text: "# Case Y" },
      ],
      missionSummary: "mission",
      productOverview: "po",
    });
    expect(r.text).toContain("case_plan_candidates");
    const call = vi.mocked(invokeAgent).mock.calls[0]![0];
    expect(call.userMessage).toContain("# Case X");
    expect(call.userMessage).toContain("# Case Y");
    expect(call.userMessage).toContain("A");
    expect(call.userMessage).toContain("B");
  });
});
