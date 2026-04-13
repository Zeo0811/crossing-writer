import { describe, it, expect, vi } from "vitest";
import { Coordinator } from "../src/roles/coordinator.js";
import * as ma from "../src/model-adapter.js";

describe("Coordinator", () => {
  it("round1 synth embeds brief + refs + round1 bundle + experts list", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "---\ntype: mission_candidates\n---",
      meta: { cli: "claude", durationMs: 5 },
    });
    const c = new Coordinator({ cli: "claude" });
    c.round1Synthesize({
      projectId: "p1",
      runId: "r1",
      briefSummary: "BRIEF_BODY",
      refsPack: "REFS_BODY",
      round1Bundle: "BUNDLE_TEXT",
      experts: ["A", "B"],
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/BRIEF_BODY/);
    expect(call.systemPrompt).toMatch(/REFS_BODY/);
    expect(call.systemPrompt).toMatch(/BUNDLE_TEXT/);
    expect(call.systemPrompt).toMatch(/p1/);
    expect(call.systemPrompt).toMatch(/\["A","B"\]/);
    expect(call.agentKey).toBe("coordinator");
  });

  it("round2 aggregate embeds candidates + round2 bundle", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "updated candidates",
      meta: { cli: "claude", durationMs: 5 },
    });
    const c = new Coordinator({ cli: "claude" });
    c.round2Aggregate({
      candidatesMd: "CANDIDATES_ORIGINAL",
      round2Bundle: "R2_BUNDLE",
    });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/CANDIDATES_ORIGINAL/);
    expect(call.systemPrompt).toMatch(/R2_BUNDLE/);
  });

  it("propagates model option", () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockReturnValue({
      text: "", meta: { cli: "claude", durationMs: 0 },
    });
    const c = new Coordinator({ cli: "claude", model: "opus" });
    c.round1Synthesize({
      projectId: "p",
      runId: "r",
      briefSummary: "b",
      refsPack: "r",
      round1Bundle: "bundle",
      experts: ["X"],
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opus" }),
    );
  });
});
