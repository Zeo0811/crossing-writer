import { describe, it, expect, vi } from "vitest";
import { runWriterPractice } from "../src/roles/writer-practice-agent.js";

describe("writer.practice runs through writer-tool-runner", () => {
  it("returns immediately when no tool", async () => {
    const invokeAgent = vi.fn().mockResolvedValue({ text: "实测段。", meta: { cli: "claude", durationMs: 5 } });
    const r = await runWriterPractice({
      invokeAgent, userMessage: "写实测",
      dispatchTool: async () => { throw new Error("noop"); },
    });
    expect(r.finalText).toBe("实测段。");
    expect(r.toolsUsed).toEqual([]);
  });
});
