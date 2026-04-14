import { describe, it, expect, vi } from "vitest";
import { runWriterOpening } from "../src/roles/writer-opening-agent.js";

describe("writer.opening runs through writer-tool-runner", () => {
  it("passes tools_used through", async () => {
    const invokeAgent = vi.fn()
      .mockResolvedValueOnce({ text: "```tool\nsearch_wiki \"AI 漫剧\"\n```", meta: { cli: "claude", durationMs: 10 } })
      .mockResolvedValueOnce({ text: "最终开头段。", meta: { cli: "claude", durationMs: 10 } });
    const dispatchTool = vi.fn(async () => ({
      ok: true as const, tool: "search_wiki", query: "AI 漫剧", args: {},
      hits: [{ path: "concepts/AI漫剧.md", title: "AI漫剧", score: 10 }],
      hits_count: 1, formatted: "- AI漫剧",
    }));
    const r = await runWriterOpening({
      invokeAgent,
      userMessage: "写开头",
      dispatchTool,
    });
    expect(r.finalText).toBe("最终开头段。");
    expect(r.toolsUsed).toHaveLength(1);
    expect(r.toolsUsed[0]!.tool).toBe("search_wiki");
    expect(invokeAgent).toHaveBeenCalledTimes(2);
  });
});
