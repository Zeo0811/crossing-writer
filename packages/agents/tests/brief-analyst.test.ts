import { describe, it, expect, vi } from "vitest";
import { BriefAnalyst } from "../src/roles/brief-analyst.js";
import * as ma from "../src/model-adapter.js";

describe("BriefAnalyst", () => {
  it("runs with interpolated prompt and returns text", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockResolvedValue({
      text: "---\ntype: brief_summary\n---\n# done",
      meta: { cli: "claude", durationMs: 10 },
    });
    const analyst = new BriefAnalyst({ cli: "claude" });
    const out = await analyst.analyze({
      projectId: "p1",
      briefBody: "Brief body",
      productInfo: "Product X",
    });
    expect(out.text).toMatch(/brief_summary/);
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/Brief body/);
    expect(call.systemPrompt).toMatch(/Product X/);
    expect(call.systemPrompt).toMatch(/p1/);
    expect(call.agentKey).toBe("brief_analyst");
  });

  it("passes through model option", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockResolvedValue({
      text: "",
      meta: { cli: "codex", durationMs: 0 },
    });
    const analyst = new BriefAnalyst({ cli: "codex", model: "gpt-5.4" });
    await analyst.analyze({ projectId: "p", briefBody: "b", productInfo: "i" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ cli: "codex", model: "gpt-5.4" }),
    );
  });

  it("includes now timestamp in vars", async () => {
    const spy = vi.spyOn(ma, "invokeAgent").mockResolvedValue({
      text: "", meta: { cli: "claude", durationMs: 0 },
    });
    const analyst = new BriefAnalyst({ cli: "claude" });
    await analyst.analyze({ projectId: "p", briefBody: "b", productInfo: "i" });
    const call = spy.mock.calls[0]![0] as any;
    expect(call.systemPrompt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
