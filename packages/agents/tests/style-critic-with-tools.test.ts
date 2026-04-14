import { describe, it, expect, vi } from "vitest";
import { runStyleCritic } from "../src/roles/style-critic-agent.js";

describe("style_critic runs through runner", () => {
  it("passes tool events through", async () => {
    const invokeAgent = vi.fn()
      .mockResolvedValueOnce({ text: "```tool\nsearch_wiki \"风格\"\n```", meta: { cli: "claude", durationMs: 5 } })
      .mockResolvedValueOnce({ text: "评价：xxx", meta: { cli: "claude", durationMs: 5 } });
    const dispatchTool = async () => ({
      ok: true as const, tool: "search_wiki", query: "风格", args: {},
      hits: [], hits_count: 0, formatted: "()",
    });
    const events: any[] = [];
    const r = await runStyleCritic({
      invokeAgent, userMessage: "评审", dispatchTool,
      onEvent: (e) => events.push(e),
    });
    expect(r.finalText).toBe("评价：xxx");
    expect(events.some((e) => e.type === "tool_called")).toBe(true);
  });
});
