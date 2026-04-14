import { describe, it, expect, vi } from "vitest";
import { runWriterWithTools } from "../src/writer-tool-runner.js";
import type { AgentInvoker, WriterToolEvent } from "../src/writer-tool-runner.js";

function makeInvoker(replies: string[]): AgentInvoker {
  let i = 0;
  return {
    invoke: vi.fn(async () => ({
      text: replies[i++] ?? "",
      meta: { cli: "claude", model: "opus", durationMs: 10 },
    })),
  };
}

describe("runWriterWithTools", () => {
  it("returns immediately when first reply has no tool block", async () => {
    const agent = makeInvoker(["这是最终段落"]);
    const result = await runWriterWithTools({
      agent,
      agentName: "writer.opening",
      systemPrompt: "sys",
      initialUserMessage: "写开头",
      dispatchTool: async () => { throw new Error("should not call"); },
    });
    expect(result.finalText).toBe("这是最终段落");
    expect(result.rounds).toBe(1);
    expect(result.toolsUsed).toEqual([]);
  });

  it("runs multi-round dialog and aggregates tools", async () => {
    const agent = makeInvoker([
      "我先查查\n```tool\nsearch_wiki \"AI 漫剧\" --kind=concept\n```",
      "再查一个\n```tool\nsearch_raw \"PixVerse\" --limit=2\n```",
      "好了这是最终段落。",
    ]);
    const dispatchTool = vi.fn(async (call) => ({
      ok: true as const,
      tool: call.command,
      query: "x",
      args: {},
      hits: [{ path: "a.md", title: "A" }],
      hits_count: 1,
      formatted: `[${call.command} fake result]`,
    }));
    const events: WriterToolEvent[] = [];
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "sys", initialUserMessage: "写",
      dispatchTool, onEvent: (e) => events.push(e),
    });
    expect(result.rounds).toBe(3);
    expect(result.finalText).toBe("好了这是最终段落。");
    expect(result.toolsUsed).toHaveLength(2);
    expect(result.toolsUsed[0]!.tool).toBe("search_wiki");
    expect(result.toolsUsed[1]!.tool).toBe("search_raw");
    expect(events.some((e) => e.type === "tool_called")).toBe(true);
    expect(events.some((e) => e.type === "tool_returned")).toBe(true);
    expect(events.some((e) => e.type === "tool_round_completed")).toBe(true);
  });

  it("stops at maxRounds and returns last assistant text", async () => {
    const replies = Array.from({ length: 10 }, (_, i) => `round ${i}\n\`\`\`tool\nsearch_wiki "q"\n\`\`\``);
    const agent = makeInvoker(replies);
    const dispatchTool = async () => ({
      ok: true as const, tool: "search_wiki", query: "q", args: {},
      hits: [], hits_count: 0, formatted: "()",
    });
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool, maxRounds: 3,
    });
    expect(result.rounds).toBe(3);
    expect(result.finalText).toContain("round 2");
  });

  it("continues round when a tool fails", async () => {
    const agent = makeInvoker([
      "```tool\nsearch_wiki \"a\"\nsearch_foo \"b\"\n```",
      "完成。",
    ]);
    const dispatchTool = vi.fn(async (call) => {
      if (call.command === "search_foo") {
        return { ok: false as const, tool: "search_foo", query: "b", args: {}, error: "unknown" };
      }
      return { ok: true as const, tool: "search_wiki", query: "a", args: {}, hits: [], hits_count: 0, formatted: "()" };
    });
    const events: WriterToolEvent[] = [];
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool, onEvent: (e) => events.push(e),
    });
    expect(result.finalText).toBe("完成。");
    expect(result.toolsUsed).toHaveLength(2);
    expect(events.some((e) => e.type === "tool_failed")).toBe(true);
  });
});
