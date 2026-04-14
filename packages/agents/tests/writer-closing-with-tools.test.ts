import { describe, it, expect, vi } from "vitest";
import { runWriterClosing } from "../src/roles/writer-closing-agent.js";

describe("writer.closing runs through runner", () => {
  it("no tool call path", async () => {
    const invokeAgent = vi.fn().mockResolvedValue({ text: "结尾。", meta: { cli: "claude", durationMs: 5 } });
    const r = await runWriterClosing({
      invokeAgent, userMessage: "写结尾",
      dispatchTool: async () => { throw new Error("noop"); },
    });
    expect(r.finalText).toBe("结尾。");
    expect(r.toolsUsed).toEqual([]);
  });
});
