import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { runSectionSlicer } from "../src/roles/section-slicer.js";

describe("runSectionSlicer", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
  });

  it("parses happy-path JSON and returns sorted valid slices", async () => {
    (invokeAgent as any).mockReturnValue({
      text: JSON.stringify([
        { start_char: 50, end_char: 80, role: "closing" },
        { start_char: 0, end_char: 10, role: "opening" },
        { start_char: 10, end_char: 50, role: "practice" },
      ]),
      meta: { cli: "claude", model: "opus", durationMs: 12 },
    });
    const body = "x".repeat(100);
    const out = await runSectionSlicer(body, { cli: "claude" });
    expect(out.slices).toHaveLength(3);
    expect(out.slices.map((s) => s.role)).toEqual(["opening", "practice", "closing"]);
    expect(out.meta.cli).toBe("claude");
    expect(out.meta.durationMs).toBe(12);
  });

  it("returns empty slices when JSON is malformed", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "not json at all",
      meta: { cli: "claude", durationMs: 1 },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await runSectionSlicer("abc", { cli: "claude" });
    expect(out.slices).toEqual([]);
    warnSpy.mockRestore();
  });

  it("filters overlapping, out-of-range, and bad-role slices", async () => {
    (invokeAgent as any).mockReturnValue({
      text: JSON.stringify([
        { start_char: 0, end_char: 10, role: "opening" },
        { start_char: 5, end_char: 20, role: "practice" }, // overlaps opening
        { start_char: 30, end_char: 200, role: "closing" }, // out of range (body=50)
        { start_char: 40, end_char: 45, role: "junk" }, // bad role
        { start_char: 45, end_char: 45, role: "other" }, // zero-length
        { start_char: -1, end_char: 5, role: "opening" }, // negative start
      ]),
      meta: { cli: "claude", durationMs: 1 },
    });
    const out = await runSectionSlicer("x".repeat(50), { cli: "claude" });
    expect(out.slices.map((s) => s.role)).toEqual(["opening"]);
    expect(out.slices[0]).toEqual({ start_char: 0, end_char: 10, role: "opening" });
  });

  it("returns empty slices when body is empty without invoking model", async () => {
    const out = await runSectionSlicer("", { cli: "claude" });
    expect(out.slices).toEqual([]);
    expect((invokeAgent as any).mock.calls.length).toBe(0);
  });

  it("strips code-fence wrapping before JSON parse", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "```json\n[{\"start_char\":0,\"end_char\":5,\"role\":\"opening\"}]\n```",
      meta: { cli: "claude", durationMs: 2 },
    });
    const out = await runSectionSlicer("hello world", { cli: "claude" });
    expect(out.slices).toHaveLength(1);
    expect(out.slices[0]!.role).toBe("opening");
  });

  it("accepts 'other' role and drops non-array JSON", async () => {
    (invokeAgent as any).mockReturnValueOnce({
      text: JSON.stringify({ not: "an array" }),
      meta: { cli: "claude", durationMs: 1 },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out1 = await runSectionSlicer("abc", { cli: "claude" });
    expect(out1.slices).toEqual([]);
    warnSpy.mockRestore();

    (invokeAgent as any).mockReturnValueOnce({
      text: JSON.stringify([{ start_char: 0, end_char: 3, role: "other" }]),
      meta: { cli: "claude", durationMs: 1 },
    });
    const out2 = await runSectionSlicer("abc", { cli: "claude" });
    expect(out2.slices).toEqual([{ start_char: 0, end_char: 3, role: "other" }]);
  });
});
